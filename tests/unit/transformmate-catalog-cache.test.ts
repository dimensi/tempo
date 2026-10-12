import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  database: null as ReturnType<
    typeof import('@/server/db/connection').openDatabase
  > | null,
}));
vi.mock('@/server/db', () => ({ getDatabase: () => state.database }));
import {
  cachedDetail,
  enrichVisible,
  refreshFull,
  refreshPage,
  refreshState,
  fresh,
  type CatalogScope,
} from '@/server/transformmate/catalog-cache';
import { catalogStore } from '@/server/transformmate/catalog-store';
import { openDatabase } from '@/server/db/connection';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { user } from '@/server/db/schema';
import { TransformMateApiError } from '@/server/transformmate/errors';
import { parseRetryAfter } from '@/server/transformmate/retry-after';
import {
  createTransformMateClient,
  type TransformMateClient,
} from '@/server/transformmate/client';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
let sequence = 0;
const list = vi.fn();
const details = vi.fn();
const page = vi.fn();
const assertCurrent = vi.fn();
let scope: CatalogScope;
const body = [{ id: 1, name: 'Приседание', metrics: [] }];
beforeEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  state.database = openDatabase('file::memory:');
  migrate(state.database.db, { migrationsFolder: './drizzle' });
  state.database.db
    .insert(user)
    .values({
      id: 'cache-test',
      name: 'Synthetic',
      role: 'OWNER',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  scope = {
    ownerId: 'cache-test',
    accountScope: 'account',
    generation: 'generation-' + ++sequence,
    locale: 'ru',
    assertCurrent,
    client: {
      listExercises: list,
      getExercise: details,
      listExercisePage: page,
    } as unknown as TransformMateClient,
  };
  assertCurrent.mockResolvedValue(undefined);
});
afterEach(() => {
  state.database?.sqlite.close();
  vi.useRealTimers();
});
it('coalesces concurrent full refresh and persists a complete scoped list', async () => {
  list.mockResolvedValue({ body });
  await Promise.all([refreshFull(scope), refreshFull(scope)]);
  expect(list).toHaveBeenCalledTimes(1);
  expect(
    catalogStore()
      .records(scope, true)
      .map((r) => r.summary),
  ).toEqual(body);
  expect(fresh(catalogStore().state(scope)?.full_catalog_fetched_at)).toBe(
    true,
  );
  expect(catalogStore().records({ ...scope, generation: 'other' })).toEqual([]);
  expect(catalogStore().records({ ...scope, accountScope: 'other' })).toEqual(
    [],
  );
});
it('filtered page cannot poison full coverage; detail aliases persist without passthrough', async () => {
  const filters = {
    query: 'squat',
    commonMuscleGroup: null,
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  page.mockResolvedValue({ body: { results: body, count: 1 } });
  await refreshPage(scope, filters);
  expect(catalogStore().state(scope)?.full_catalog_fetched_at).toBeNull();
  expect(catalogStore().records(scope, true)).toEqual([]);
  details.mockResolvedValue({
    body: {
      ...exerciseDetailFixture(),
      id: 1,
      other_names: ['Squat'],
      secret: 'discard-me',
    },
  });
  await Promise.all([cachedDetail(scope, 1), cachedDetail(scope, 1)]);
  await cachedDetail(scope, 1);
  expect(details).toHaveBeenCalledTimes(1);
  expect(catalogStore().records(scope)[0]?.detail?.other_names).toEqual([
    'Squat',
  ]);
  expect(JSON.stringify(catalogStore().records(scope))).not.toContain(
    'discard-me',
  );
});
it('never persists after revoked binding and does not turn failures into empty completeness', async () => {
  list.mockResolvedValue({ body });
  assertCurrent.mockRejectedValue(new Error('binding changed'));
  await expect(refreshFull(scope)).rejects.toThrow('binding changed');
  expect(catalogStore().state(scope)).toBeUndefined();
  expect(refreshState(scope, ':full')).toBe('unavailable');
});
it('bounds shared 429 cooldown while retaining stale detail', async () => {
  vi.useFakeTimers();
  list.mockRejectedValueOnce(
    new TransformMateApiError({
      status: 429,
      statusText: '',
      contentType: '',
      isJson: false,
      body: null,
      retryAfterMs: 999999,
    }),
  );
  await expect(refreshFull(scope)).rejects.toMatchObject({ status: 429 });
  await expect(refreshFull(scope)).rejects.toThrow('cooldown');
  expect(list).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60000);
  list.mockResolvedValue({ body });
  await refreshFull(scope);
  expect(list).toHaveBeenCalledTimes(2);
});
it('parses safe bounded Retry-After metadata', () => {
  expect(parseRetryAfter('10', 0)).toBe(10000);
  expect(parseRetryAfter('999999', 0)).toBe(60000);
  expect(parseRetryAfter('secret invalid', 0)).toBe(5000);
});
it('captures only parsed Retry-After and performs one 429 request', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '999999' } }),
    );
  const client = createTransformMateClient({
    baseUrl: 'https://example.test/',
    tokenProvider: { getIdToken: async () => 'synthetic' },
    fetch: request,
  });
  await expect(client.listExercises()).rejects.toMatchObject({
    status: 429,
    retryAfterMs: 60000,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it('bounds explicitly visible enrichment to six IDs and two concurrent requests', async () => {
  let active = 0,
    maximum = 0;
  details.mockImplementation(async (id) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { body: { ...exerciseDetailFixture(), id } };
  });
  await enrichVisible(scope, [1, 2, 3, 4, 5, 6, 7, 8]);
  expect(details).toHaveBeenCalledTimes(6);
  expect(maximum).toBeLessThanOrEqual(2);
  await enrichVisible(scope, [1, 2, 3]);
  expect(details).toHaveBeenCalledTimes(6);
});
