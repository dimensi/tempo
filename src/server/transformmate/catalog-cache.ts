import 'server-only';
import type { TransformMateClient } from '@/server/transformmate/client';
import type { CatalogIdentity } from '@/server/transformmate/catalog-store';
import { catalogStore } from '@/server/transformmate/catalog-store';
import { projectDetail } from '@/server/transformmate/catalog-projection';
import { TransformMateApiError } from '@/server/transformmate/errors';
import { MAX_RETRY_AFTER_MS } from '@/server/transformmate/retry-after';
import type { TransformMateCatalogFilters } from '@/contracts/transformmate';
export type CatalogScope = CatalogIdentity & {
  client: TransformMateClient;
  assertCurrent: () => Promise<void>;
};
export const CATALOG_TTL_MS = 5 * 60_000;
const pending = new Map<string, Promise<unknown>>();
const cooldown = new Map<string, number>();
const failed = new Set<string>();
let runningDetails = 0;
const detailWaiters: { priority: boolean; run: () => void }[] = [];
async function detailSlot<T>(work: () => Promise<T>, priority: boolean) {
  if (detailWaiters.length >= 64) throw new Error('Catalog detail queue full');
  if (runningDetails >= 2)
    await new Promise<void>((resolve) => {
      const waiter = { priority, run: resolve };
      if (priority) {
        const firstVisible = detailWaiters.findIndex(
          (entry) => !entry.priority,
        );
        detailWaiters.splice(
          firstVisible < 0 ? detailWaiters.length : firstVisible,
          0,
          waiter,
        );
      } else detailWaiters.push(waiter);
    });
  else runningDetails++;
  try {
    return await work();
  } finally {
    const next = detailWaiters.shift();
    if (next) next.run();
    else runningDetails--;
  }
}
function boundFailures() {
  while (failed.size > 256) failed.delete(failed.values().next().value!);
  while (cooldown.size > 32) cooldown.delete(cooldown.keys().next().value!);
}
export function scopeKey(scope: CatalogIdentity) {
  return JSON.stringify([
    scope.ownerId,
    scope.accountScope,
    scope.generation,
    scope.locale,
  ]);
}
export function fresh(at: string | null | undefined) {
  return Boolean(at && Date.now() - Date.parse(at) < CATALOG_TTL_MS);
}
export function invalidateTransformMateCatalog(ownerId: string) {
  // Persisted generations stay private/inaccessible; pending old writes fail fences.
  for (const key of [...cooldown.keys()])
    if (key.startsWith(JSON.stringify([ownerId]).slice(0, -1) + ','))
      cooldown.delete(key);
}
export function refreshState(scope: CatalogScope, operation: string) {
  const key = scopeKey(scope) + operation;
  return pending.has(key)
    ? ('updating' as const)
    : failed.has(key)
      ? ('unavailable' as const)
      : ('idle' as const);
}
async function coalesce<T>(
  scope: CatalogScope,
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = scopeKey(scope) + operation;
  const current = pending.get(key);
  if (current) return current as Promise<T>;
  if ((cooldown.get(scopeKey(scope)) ?? 0) > Date.now()) {
    failed.add(key);
    throw new Error('Catalog cooldown');
  }
  const task = work()
    .then((result) => {
      failed.delete(key);
      return result;
    })
    .catch((error: unknown) => {
      failed.add(key);
      if (error instanceof TransformMateApiError && error.status === 429)
        cooldown.set(
          scopeKey(scope),
          Date.now() +
            Math.min(
              MAX_RETRY_AFTER_MS,
              Math.max(1000, error.retryAfterMs ?? 5000),
            ),
        );
      boundFailures();
      throw error;
    })
    .finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
  pending.set(key, task);
  return task;
}
export function queryKey(filters: TransformMateCatalogFilters) {
  return JSON.stringify(filters);
}
export async function refreshFull(scope: CatalogScope) {
  return coalesce(scope, ':full', async () => {
    const { body } = await scope.client.listExercises();
    await scope.assertCurrent();
    catalogStore().full(scope, body, new Date().toISOString());
  });
}
export async function refreshPage(
  scope: CatalogScope,
  filters: TransformMateCatalogFilters,
) {
  return coalesce(scope, ':page:' + queryKey(filters), async () => {
    const { body } = await scope.client.listExercisePage({
      search: filters.query,
      ...(filters.commonMuscleGroup
        ? { commonMuscleGroup: filters.commonMuscleGroup }
        : {}),
      muscleGroups: filters.muscleGroups,
      offset: filters.offset,
      limit: filters.limit,
    });
    await scope.assertCurrent();
    catalogStore().page(
      scope,
      queryKey(filters),
      body.results,
      body.count,
      filters.offset + body.results.length < body.count,
      new Date().toISOString(),
    );
  });
}
export async function refreshDictionary(scope: CatalogScope) {
  return coalesce(scope, ':dictionary', async () => {
    const { body } = await scope.client.listMuscleGroups();
    const groups = body.map((group) => ({
      id: group.id,
      name: group.name,
      commonGroup: group.common_muscle_group,
      muscleIds: group.muscles,
    }));
    await scope.assertCurrent();
    catalogStore().dictionary(scope, groups, new Date().toISOString());
  });
}
export async function cachedDetail(
  scope: CatalogScope,
  id: number,
  force = false,
  priority = true,
) {
  const current = catalogStore().record(scope, id);
  if (!force && current?.detail && fresh(current.detailFetchedAt))
    return current;
  try {
    await coalesce(scope, ':detail:' + id, async () => {
      const { body } = await detailSlot(async () => {
        await scope.assertCurrent();
        return scope.client.getExercise(id);
      }, priority);
      if (body.id !== id) throw new Error('Catalog exercise mismatch');
      const detail = projectDetail(body);
      await scope.assertCurrent();
      catalogStore().detail(scope, detail, new Date().toISOString());
    });
  } catch (error) {
    if (force || !current?.detail) throw error;
  }
  const result = catalogStore().record(scope, id);
  if (!result?.detail) throw new Error('Catalog detail unavailable');
  return result;
}
// Caller supplies visible IDs once per visible page, never a request per keystroke.
export async function enrichVisible(scope: CatalogScope, ids: number[]) {
  const queue = [...new Set(ids)].slice(0, 6);
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        await cachedDetail(scope, id, false, false);
      } catch {
        /* Item retains unknown coverage. */
      }
    }
  }
  await Promise.all([worker(), worker()]);
}
