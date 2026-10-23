import 'server-only';
import { z } from 'zod';
import { transformMateMessages } from '@/server/transformmate/messages';
import { authorize } from '@/server/auth/guards';
import {
  getTransformMateConnectionFence,
  getTransformMateCatalogBindingFence,
} from '@/server/transformmate/runtime';
import { replicaStore } from './replica-store';
import {
  cachedDetail,
  enrichVisible,
  fresh,
  refreshDictionary,
  refreshFull,
  type CatalogScope,
} from '@/server/transformmate/catalog-cache';
import { catalogStore } from '@/server/transformmate/catalog-store';
import {
  catalogItem,
  detailInfo,
} from '@/server/transformmate/catalog-projection';
import {
  CatalogError,
  TransformMateApiError,
} from '@/server/transformmate/errors';
import { selectMediaUrl } from '@/server/transformmate/catalog-schema';
import {
  transformMateCatalogFiltersSchema,
  transformMateCatalogMetadataSchema,
  transformMateMuscleDictionarySchema,
  type TransformMateCatalogFilters,
} from '@/contracts/transformmate';

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
  const binding = await getTransformMateCatalogBindingFence(ownerId);
  if (!binding.accountScope) throw new CatalogError(503);
  const fence = binding.configured
    ? await getTransformMateConnectionFence(ownerId)
    : null;
  const assertCurrent = async () => {
    await binding.assertCurrent();
    await requireCatalogAccess(headers, ownerId);
    binding.assertBindingCurrent();
  };
  await assertCurrent();
  return {
    ownerId,
    accountScope: binding.accountScope,
    locale: 'ru',
    client: fence?.client ?? null,
    assertCurrent,
    assertUpstreamCurrent: async () => {
      await assertCurrent();
      if (!fence) throw new CatalogError(503);
      await fence.assertCurrent();
      fence.assertBindingCurrent();
    },
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
  let state = store.state(scope);
  if (!state?.full_catalog_fetched_at && scope.client) {
    try {
      await refreshFull(scope);
    } catch {
      /* Cold failure remains unknown. */
    }
  }
  await scope.assertCurrent();
  state = store.state(scope);
  const allRecords = store.records(scope, true);
  let records = allRecords;
  const unknownMembershipCount = records.filter((r) => !r.detail).length;
  let coverage: 'unknown' | 'partial' | 'complete' =
    state?.full_catalog_fetched_at ? 'complete' : 'unknown';
  const fetchedAt = state?.full_catalog_fetched_at ?? null;
  if (!isFull) {
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
    if (
      unknownMembershipCount &&
      (filters.query ||
        filters.commonMuscleGroup ||
        filters.muscleGroups.length)
    )
      coverage = 'partial';
  }
  const total = coverage === 'complete' ? records.length : null;
  const hasMore = records.length > filters.offset + filters.limit;
  records = records.slice(filters.offset, filters.offset + filters.limit);
  if (visible.length) {
    const ids = z
      .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
      .max(6)
      .parse(visible);
    const allowed = new Set(records.map((r) => r.id));
    enrichVisible(
      scope,
      ids.filter((id) => allowed.has(id)),
    );
  }
  const replicaState = replicaStore().state(scope);
  const enrichmentCandidates =
    coverage === 'partial'
      ? [...allRecords.filter((record) => !record.detail), ...records]
      : records;
  const pendingEnrichment =
    Boolean(scope.client) &&
    enrichmentCandidates.some((record) => {
      const job = replicaStore().job(scope, `exercise:${record.id}`);
      return (
        job &&
        !Object.keys(job.data.failures).length &&
        job.next_at <= Date.now()
      );
    });
  await scope.assertCurrent();
  return {
    items: records.map((r) =>
      catalogItem(r.summary, r.fetchedAt, r.detail, r.detailFetchedAt, scope),
    ),
    metadata: transformMateCatalogMetadataSchema.parse({
      fetchedAt,
      stale: !fresh(fetchedAt),
      coverage,
      total,
      hasMore,
      unknownMembershipCount,
      refreshState: replicaState.reason
        ? 'unavailable'
        : pendingEnrichment
          ? 'updating'
          : 'idle',
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
    Boolean(replicaStore().job(scope, `exercise:${id}`)?.data.video) ||
      selectMediaUrl(row.detail!) !== null,
    scope,
  );
}
export async function muscleDictionary(headers: Headers, ownerId: string) {
  const scope = await catalogScope(headers, ownerId);
  const store = catalogStore();
  const state = store.state(scope);
  if (!state?.dictionary && scope.client) {
    try {
      await refreshDictionary(scope);
    } catch {
      /* Unknown dictionary remains explicit. */
    }
  }
  await scope.assertCurrent();
  const current = store.state(scope);
  return transformMateMuscleDictionarySchema.parse({
    groups: current?.dictionary ? JSON.parse(current.dictionary) : [],
    fetchedAt: current?.dictionary_fetched_at ?? null,
    stale: !fresh(current?.dictionary_fetched_at),
    coverage: current?.dictionary ? 'complete' : 'unknown',
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
            : error instanceof TransformMateApiError &&
                [404, 429].includes(error.status)
              ? error.status
              : error instanceof z.ZodError
                ? 400
                : 502,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}

/** Saved catalog only: MCP discovery never performs upstream refresh or exposes media. */
export async function searchSavedExercises(
  headers: Headers,
  ownerId: string,
  query: string,
) {
  const scope = await catalogScope(headers, ownerId);
  const state = catalogStore().state(scope);
  const saved = catalogStore().records(scope, true);
  const unknownAliasCount = saved.filter((row) => !row.detail).length;
  const records = saved
    .filter((row) =>
      [row.summary.name, ...(row.detail?.other_names ?? [])].some((name) =>
        name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')),
      ),
    )
    .map((row) => ({
      exerciseId: row.id,
      name: row.summary.name,
      aliases: row.detail?.other_names ?? [],
      fetchedAt: row.fetchedAt,
    }));
  await scope.assertCurrent();
  return {
    records,
    coverage: state?.full_catalog_fetched_at
      ? unknownAliasCount
        ? 'partial'
        : 'complete'
      : 'unknown',
    unknownAliasCount,
    fetchedAt: state?.full_catalog_fetched_at ?? null,
  };
}
