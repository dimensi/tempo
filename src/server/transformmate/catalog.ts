import 'server-only';
import { z } from 'zod';
import { transformMateMessages } from '@/server/transformmate/messages';
import { authorize } from '@/server/auth/guards';
import { getTransformMateConnectionFence } from '@/server/transformmate/runtime';
import {
  cachedDetail,
  enrichVisible,
  fresh,
  queryKey,
  refreshDictionary,
  refreshFull,
  refreshPage,
  refreshState,
  type CatalogScope,
} from '@/server/transformmate/catalog-cache';
import { catalogStore } from '@/server/transformmate/catalog-store';
import {
  catalogItem,
  detailInfo,
} from '@/server/transformmate/catalog-projection';
import { TransformMateApiError } from '@/server/transformmate/errors';
import { selectMediaUrl } from '@/server/transformmate/catalog-schema';
import {
  transformMateCatalogFiltersSchema,
  transformMateCatalogMetadataSchema,
  transformMateMuscleDictionarySchema,
  type TransformMateCatalogFilters,
} from '@/contracts/transformmate';

export class CatalogError extends Error {
  constructor(public readonly status: number) {
    super('TransformMate catalog unavailable');
  }
}
export async function requireCatalogAccess(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'workouts:read', ownerId);
  if (!access.ok) throw new CatalogError(access.status);
}
export function exerciseId(value: string) {
  return z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(value);
}
export async function catalogScope(
  headers: Headers,
  ownerId: string,
): Promise<CatalogScope> {
  await requireCatalogAccess(headers, ownerId);
  const fence = await getTransformMateConnectionFence(ownerId);
  if (!fence) throw new CatalogError(503);
  const assertCurrent = async () => {
    await fence.assertCurrent();
    await requireCatalogAccess(headers, ownerId);
    fence.assertBindingCurrent();
  };
  await assertCurrent();
  return {
    ownerId,
    accountScope: fence.accountScope,
    generation: fence.generation,
    locale: 'ru',
    client: fence.client,
    assertCurrent,
  };
}
export function normalizeFilters(input: TransformMateCatalogFilters) {
  const parsed = transformMateCatalogFiltersSchema.parse(input);
  return {
    ...parsed,
    query: parsed.query.trim().toLocaleLowerCase('ru'),
    muscleGroups: [...new Set(parsed.muscleGroups)].sort(),
  };
}
export async function listCatalog(
  headers: Headers,
  ownerId: string,
  input: TransformMateCatalogFilters,
  visible: number[] = [],
) {
  const filters = normalizeFilters(input);
  const scope = await catalogScope(headers, ownerId);
  const store = catalogStore();
  const isFull =
    !filters.query &&
    !filters.commonMuscleGroup &&
    filters.muscleGroups.length === 0;
  let snapshot = isFull ? null : store.query(scope, queryKey(filters));
  let state = store.state(scope);
  const needsMembershipFill =
    !snapshot &&
    Boolean(filters.commonMuscleGroup || filters.muscleGroups.length) &&
    (!state?.full_catalog_fetched_at ||
      store.records(scope, true).some((row) => !row.detail));
  // Text inputs stay local; unknown muscle membership needs one cached provider page.
  const useFull = isFull || (!snapshot && !needsMembershipFill);
  const operation = useFull ? ':full' : ':page:' + queryKey(filters);
  const at = useFull ? state?.full_catalog_fetched_at : snapshot?.fetchedAt;
  if (!fresh(at)) {
    const refresh = useFull ? refreshFull(scope) : refreshPage(scope, filters);
    if (at) void refresh.catch(() => {});
    else
      try {
        await refresh;
      } catch (error) {
        if (error instanceof CatalogError) throw error;
        /* Cold upstream failure has explicit unknown metadata. */
      }
  }
  await scope.assertCurrent();
  state = store.state(scope);
  snapshot = isFull ? null : store.query(scope, queryKey(filters));
  let records = store.records(scope, isFull);
  let unknownMembershipCount = records.filter((row) => !row.detail).length;
  let coverage: 'unknown' | 'partial' | 'complete' = 'complete';
  let total: number | null;
  let fetchedAt: string | null;
  let hasMore: boolean;
  if (isFull) {
    fetchedAt = state?.full_catalog_fetched_at ?? null;
    total = state?.full_catalog_count ?? null;
    coverage = fetchedAt ? 'complete' : 'unknown';
    hasMore = total !== null && filters.offset + filters.limit < total;
    records = records.slice(filters.offset, filters.offset + filters.limit);
  } else if (snapshot) {
    records = snapshot.ids.flatMap((id) => {
      const row = store.record(scope, id);
      return row ? [row] : [];
    });
    fetchedAt = snapshot.fetchedAt;
    total = snapshot.total;
    hasMore = snapshot.hasMore;
    if (records.length !== snapshot.ids.length) coverage = 'partial';
  } else {
    // Known aliases improve local results, but cannot establish provider completeness.
    records = records.filter(
      (r) =>
        !filters.query ||
        [r.summary.name, ...(r.detail?.other_names ?? [])].some((name) =>
          name.toLocaleLowerCase('ru').includes(filters.query),
        ),
    );
    if (filters.commonMuscleGroup || filters.muscleGroups.length) {
      const dictionary = state?.dictionary
        ? transformMateMuscleDictionarySchema.shape.groups.parse(
            JSON.parse(state.dictionary),
          )
        : [];
      records = records.filter((r) => {
        if (!r.detail) return false;
        const groups = r.detail.muscles.map(
          ({ muscle }) => muscle.muscle_group,
        );
        const subgroupMatch =
          !filters.muscleGroups.length ||
          groups.some((group) => filters.muscleGroups.includes(group.name));
        const commonMatch =
          !filters.commonMuscleGroup ||
          groups.some((group) =>
            dictionary.some(
              (entry) =>
                entry.id === group.id &&
                entry.name === group.name &&
                entry.commonGroup.name === filters.commonMuscleGroup,
            ),
          );
        return subgroupMatch && commonMatch;
      });
    }
    fetchedAt = state?.full_catalog_fetched_at ?? null;
    total = null;
    hasMore = records.length > filters.offset + filters.limit;
    coverage = records.length ? 'partial' : 'unknown';
    records = records.slice(filters.offset, filters.offset + filters.limit);
  }
  if (visible.length) {
    const ids = z
      .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
      .max(6)
      .parse(visible);
    const allowed = new Set(records.map((r) => r.id));
    await enrichVisible(
      scope,
      ids.filter((id) => allowed.has(id)),
    );
    records = records.map((r) => store.record(scope, r.id) ?? r);
  }
  await scope.assertCurrent();
  if (isFull || snapshot)
    unknownMembershipCount = records.filter((row) => !row.detail).length;
  return {
    items: records.map((r) =>
      catalogItem(r.summary, r.fetchedAt, r.detail, r.detailFetchedAt, ownerId),
    ),
    metadata: transformMateCatalogMetadataSchema.parse({
      fetchedAt,
      stale: !fresh(fetchedAt),
      coverage,
      total,
      hasMore,
      unknownMembershipCount,
      refreshState: refreshState(scope, operation),
      filters,
    }),
  };
}
export async function getExercise(
  headers: Headers,
  ownerId: string,
  id: number,
  force = false,
) {
  const scope = await catalogScope(headers, ownerId);
  const row = await cachedDetail(scope, id, force);
  await scope.assertCurrent();
  return row.detail!;
}
export async function exerciseInfo(
  headers: Headers,
  ownerId: string,
  id: number,
) {
  const scope = await catalogScope(headers, ownerId);
  const row = await cachedDetail(scope, id);
  await scope.assertCurrent();
  return detailInfo(
    row.summary,
    row.fetchedAt,
    row.detail!,
    row.detailFetchedAt!,
    !fresh(row.detailFetchedAt),
    selectMediaUrl(row.detail!) !== null,
    ownerId,
  );
}
export async function muscleDictionary(headers: Headers, ownerId: string) {
  const scope = await catalogScope(headers, ownerId);
  const store = catalogStore();
  let state = store.state(scope);
  if (!fresh(state?.dictionary_fetched_at)) {
    const refresh = refreshDictionary(scope);
    if (state?.dictionary) void refresh.catch(() => {});
    else
      try {
        await refresh;
      } catch {
        /* Unknown dictionary remains explicit. */
      }
  }
  await scope.assertCurrent();
  state = store.state(scope);
  return transformMateMuscleDictionarySchema.parse({
    groups: state?.dictionary ? JSON.parse(state.dictionary) : [],
    fetchedAt: state?.dictionary_fetched_at ?? null,
    stale: !fresh(state?.dictionary_fetched_at),
    coverage: state?.dictionary ? 'complete' : 'unknown',
  });
}
export async function catalogResponse(
  operation: () => Promise<unknown>,
  catalog = false,
) {
  try {
    const result = await operation();
    const body = catalog
      ? (() => {
          const r = result as Awaited<ReturnType<typeof listCatalog>>;
          return {
            contractVersion: 1,
            source: 'user',
            data: r.items,
            catalog: r.metadata,
          };
        })()
      : { contractVersion: 1, source: 'user', data: result };
    return Response.json(body, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: transformMateMessages.unavailable },
      {
        status:
          error instanceof CatalogError
            ? error.status
            : error instanceof TransformMateApiError && error.status === 429
              ? 429
              : error instanceof z.ZodError
                ? 400
                : 502,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
