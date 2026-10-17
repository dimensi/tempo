import 'server-only';
import type { TransformMateClient } from './client';
import type { CatalogIdentity } from './catalog-store';
import { catalogStore } from './catalog-store';
import { projectDetail } from './catalog-projection';
import { replicaRequest } from './replica-gate';
import { replicaStore, monthFrom } from './replica-store';
export type CatalogScope = CatalogIdentity & {
  client: TransformMateClient | null;
  assertCurrent: () => Promise<void>;
  assertUpstreamCurrent: () => Promise<void>;
};
export const CATALOG_TTL_MS = 30 * 86400000;
export const fresh = (at: string | null | undefined) =>
  Boolean(at && Date.now() - Date.parse(at) < CATALOG_TTL_MS);
const pending = new Map<string, Promise<unknown>>();
export const scopeKey = (s: CatalogIdentity) =>
  JSON.stringify([s.ownerId, s.accountScope, s.locale]);
async function coalesce<T>(
  scope: CatalogScope,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const id = scopeKey(scope) + key;
  const active = pending.get(id);
  if (active) return active as Promise<T>;
  const task = replicaRequest(scope, async () => {
    await scope.assertUpstreamCurrent();
    const result = await work();
    await scope.assertUpstreamCurrent();
    return result;
  }).finally(() => {
    pending.delete(id);
  });
  pending.set(id, task);
  return task;
}
export async function refreshFull(scope: CatalogScope) {
  return coalesce(scope, ':full', async () => {
    if (!scope.client) throw new Error('Not connected');
    const { body } = await scope.client.listExercises();
    await scope.assertUpstreamCurrent();
    catalogStore().full(scope, body, new Date().toISOString());
    for (const row of catalogStore().records(scope, true))
      replicaStore().enqueue(scope, `exercise:${row.id}`);
  });
}
export async function refreshDictionary(scope: CatalogScope) {
  return coalesce(scope, ':dictionary', async () => {
    if (!scope.client) throw new Error('Not connected');
    const { body } = await scope.client.listMuscleGroups();
    await scope.assertUpstreamCurrent();
    catalogStore().dictionary(
      scope,
      body.map((g) => ({
        id: g.id,
        name: g.name,
        commonGroup: g.common_muscle_group,
        muscleIds: g.muscles,
      })),
      new Date().toISOString(),
    );
  });
}
export async function cachedDetail(
  scope: CatalogScope,
  id: number,
  force = false,
) {
  const current = catalogStore().record(scope, id);
  if (!force && current?.detail) return current;
  if (!scope.client) throw new Error('Not connected');
  await coalesce(scope, ':detail:' + id, async () => {
    const { body } = await scope.client!.getExercise(id);
    if (body.id !== id) throw new Error('Catalog exercise mismatch');
    const detail = projectDetail(body);
    await scope.assertUpstreamCurrent();
    catalogStore().detail(scope, detail, new Date().toISOString());
    const store = replicaStore();
    store.enqueue(scope, `exercise:${id}`, 0, 100);
    const job = store.job(scope, `exercise:${id}`)!;
    job.data.detailAt = monthFrom(Date.now());
    store.save(scope, job);
  });
  const row = catalogStore().record(scope, id);
  if (!row?.detail) throw new Error('Catalog unavailable');
  return row;
}
export function enrichVisible(scope: CatalogScope, ids: number[]) {
  for (const id of [...new Set(ids)].slice(0, 6))
    replicaStore().enqueue(scope, `exercise:${id}`, 0, 50);
}
