import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  database: null as ReturnType<
    typeof import('@/server/db/connection').openDatabase
  > | null,
}));
vi.mock('@/server/db', () => ({ getDatabase: () => state.database }));
vi.mock('@/server/auth/guards', () => ({
  authorize: async () => ({ ok: true }),
}));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateConnectionFence: async () => ({
    accountScope: scope.accountScope,
    generation: scope.generation,
    client: scope.client,
    assertCurrent,
    assertBindingCurrent: () => {},
  }),
}));
import { listCatalog, muscleDictionary } from '@/server/transformmate/catalog';
import {
  CATALOG_TTL_MS,
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
const dictionary = vi.fn();
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
      listMuscleGroups: dictionary,
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

it('keeps month-old catalog data fresh until the boundary', () => {
  vi.useFakeTimers();
  const now = Date.now();
  expect(CATALOG_TTL_MS).toBe(30 * 24 * 60 * 60_000);
  expect(fresh(new Date(now - CATALOG_TTL_MS + 1).toISOString())).toBe(true);
  expect(fresh(new Date(now - CATALOG_TTL_MS).toISOString())).toBe(false);
});
it('returns stale detail immediately and deduplicates its background refresh', async () => {
  vi.useFakeTimers();
  details.mockResolvedValueOnce({
    body: { ...exerciseDetailFixture(), id: 1 },
  });
  await cachedDetail(scope, 1);
  vi.advanceTimersByTime(CATALOG_TTL_MS - 1);
  await cachedDetail(scope, 1);
  expect(details).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  let finish!: (value: unknown) => void;
  details.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const original = catalogStore().record(scope, 1);
  const rows = await Promise.all([
    cachedDetail(scope, 1),
    cachedDetail(scope, 1),
  ]);
  expect(rows).toEqual([original, original]);
  expect(details).toHaveBeenCalledTimes(2);
  expect(refreshState(scope, ':detail:1')).toBe('updating');
  const forced = cachedDetail(scope, 1, true);
  finish({
    body: { ...exerciseDetailFixture(), id: 1, description: 'Refreshed' },
  });
  expect((await forced).detail?.description).toBe('Refreshed');
  expect(details).toHaveBeenCalledTimes(2);
});
it('retains stale details and suppresses outage retries across different queries', async () => {
  vi.useFakeTimers();
  details.mockResolvedValueOnce({
    body: { ...exerciseDetailFixture(), id: 1 },
  });
  await cachedDetail(scope, 1);
  vi.advanceTimersByTime(CATALOG_TTL_MS);
  details.mockRejectedValueOnce(new Error('synthetic outage'));
  const stale = await cachedDetail(scope, 1);
  await vi.waitFor(() =>
    expect(refreshState(scope, ':detail:1')).toBe('unavailable'),
  );
  expect(stale.detail).toBeTruthy();
  expect(await cachedDetail(scope, 1)).toEqual(stale);
  for (const query of ['s', 'sq', 'squ']) {
    await expect(
      refreshPage(scope, {
        query,
        commonMuscleGroup: null,
        muscleGroups: [],
        offset: 0,
        limit: 50,
      }),
    ).rejects.toThrow('cooldown');
  }
  expect(page).not.toHaveBeenCalled();
  expect(details).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_000);
  details.mockResolvedValueOnce({
    body: { ...exerciseDetailFixture(), id: 1 },
  });
  await cachedDetail(scope, 1, true);
  expect(details).toHaveBeenCalledTimes(3);
});
it('forced detail refresh propagates failures while preserving stored metadata', async () => {
  details.mockResolvedValueOnce({
    body: { ...exerciseDetailFixture(), id: 1 },
  });
  await cachedDetail(scope, 1);
  const original = catalogStore().record(scope, 1);
  details.mockRejectedValueOnce(new Error('expired media refresh failed'));
  await expect(cachedDetail(scope, 1, true)).rejects.toThrow(
    'expired media refresh failed',
  );
  expect(catalogStore().record(scope, 1)).toEqual(original);
});
it('rejects a late detail refresh after the connection or authorization fence changes', async () => {
  let finish!: (value: unknown) => void;
  details.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = cachedDetail(scope, 1);
  await vi.waitFor(() => expect(details).toHaveBeenCalledTimes(1));
  assertCurrent.mockRejectedValue(new Error('access revoked'));
  finish({ body: { ...exerciseDetailFixture(), id: 1 } });
  await expect(loading).rejects.toThrow('access revoked');
  expect(catalogStore().record(scope, 1)).toBeNull();
});

it('cold catalog reads fetch once; warm list, query and dictionary stay local for a month', async () => {
  vi.useFakeTimers();
  list.mockResolvedValue({ body });
  page.mockResolvedValue({ body: { results: body, count: 1 } });
  dictionary.mockResolvedValue({ body: [] });
  const filters = {
    query: '',
    commonMuscleGroup: null,
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  const headers = new Headers();
  await Promise.all([
    listCatalog(headers, scope.ownerId, filters),
    listCatalog(headers, scope.ownerId, filters),
  ]);
  await refreshPage(scope, { ...filters, query: 'squat' });
  await listCatalog(headers, scope.ownerId, { ...filters, query: 'squat' });
  await muscleDictionary(headers, scope.ownerId);
  vi.advanceTimersByTime(CATALOG_TTL_MS - 1);
  expect(
    (await listCatalog(headers, scope.ownerId, filters)).metadata.stale,
  ).toBe(false);
  expect(
    (await listCatalog(headers, scope.ownerId, { ...filters, query: 'squat' }))
      .items,
  ).toHaveLength(1);
  expect((await muscleDictionary(headers, scope.ownerId)).stale).toBe(false);
  expect(list).toHaveBeenCalledTimes(1);
  expect(page).toHaveBeenCalledTimes(1);
  expect(dictionary).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  let finish!: (value: unknown) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stale = await Promise.all([
    listCatalog(headers, scope.ownerId, filters),
    listCatalog(headers, scope.ownerId, filters),
  ]);
  expect(
    stale.every(
      (result) =>
        result.items.length === 1 &&
        result.metadata.stale &&
        result.metadata.refreshState === 'updating',
    ),
  ).toBe(true);
  expect(list).toHaveBeenCalledTimes(2);
  finish({ body });
  await refreshFull(scope);
});

it('serves persisted details after SQLite reopen and process cache module reset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-ram-reset-'));
  const url = `file:${join(directory, 'synthetic.sqlite')}`;
  state.database!.sqlite.close();
  state.database = openDatabase(url);
  try {
    migrate(state.database.db, { migrationsFolder: './drizzle' });
    state.database.db
      .insert(user)
      .values({
        id: scope.ownerId,
        name: 'Synthetic',
        role: 'OWNER',
        email: 'restart@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    details.mockResolvedValueOnce({
      body: { ...exerciseDetailFixture(), id: 1 },
    });
    await cachedDetail(scope, 1);
    state.database.sqlite.close();
    state.database = openDatabase(url);
    vi.resetModules();
    const restarted = await import('@/server/transformmate/catalog-cache');
    expect((await restarted.cachedDetail(scope, 1)).detail?.id).toBe(1);
    expect(details).toHaveBeenCalledTimes(1);
    expect(restarted.refreshState(scope, ':detail:1')).toBe('idle');
  } finally {
    state.database.sqlite.close();
    state.database = null;
    rmSync(directory, { recursive: true, force: true });
  }
});

it('fresh full cache serves each unseen typed query locally with partial coverage', async () => {
  list.mockResolvedValue({ body });
  page.mockResolvedValue({ body: { results: body, count: 1 } });
  const filters = {
    query: '',
    commonMuscleGroup: null,
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  await listCatalog(new Headers(), scope.ownerId, filters);
  for (const query of ['п', 'пр', 'при']) {
    const result = await listCatalog(new Headers(), scope.ownerId, {
      ...filters,
      query,
    });
    expect(result.items.map((item) => item.id)).toEqual([1]);
    expect(result.metadata).toMatchObject({
      coverage: 'partial',
      total: null,
      stale: false,
    });
  }
  expect(page).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledTimes(1);
});

it('cold typed queries share one full bootstrap, then retain authoritative query snapshots', async () => {
  let finish!: (value: unknown) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const filters = {
    query: '',
    commonMuscleGroup: null,
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  const results = Promise.all(
    ['п', 'пр', 'при'].map((query) =>
      listCatalog(new Headers(), scope.ownerId, { ...filters, query }),
    ),
  );
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  expect(page).not.toHaveBeenCalled();
  finish({ body });
  expect(
    (await results).every(
      (result) =>
        result.metadata.coverage === 'partial' && result.items.length === 1,
    ),
  ).toBe(true);
  const authoritative = { ...filters, query: 'при' };
  catalogStore().page(
    scope,
    JSON.stringify(authoritative),
    [],
    0,
    false,
    new Date().toISOString(),
  );
  const stored = await listCatalog(new Headers(), scope.ownerId, authoritative);
  expect(stored.items).toEqual([]);
  expect(stored.metadata).toMatchObject({ coverage: 'complete', total: 0 });
  expect(list).toHaveBeenCalledTimes(1);
  expect(page).not.toHaveBeenCalled();
});
it('stale full cache returns typed results immediately with one background full refresh', async () => {
  vi.useFakeTimers();
  catalogStore().full(
    scope,
    body,
    new Date(Date.now() - CATALOG_TTL_MS).toISOString(),
  );
  let finish!: (value: unknown) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const filters = {
    query: '',
    commonMuscleGroup: null,
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  const results = await Promise.all(
    ['п', 'пр', 'при'].map((query) =>
      listCatalog(new Headers(), scope.ownerId, { ...filters, query }),
    ),
  );
  expect(
    results.every(
      (result) =>
        result.items.length === 1 &&
        result.metadata.coverage === 'partial' &&
        result.metadata.stale &&
        result.metadata.refreshState === 'updating',
    ),
  ).toBe(true);
  expect(list).toHaveBeenCalledTimes(1);
  expect(page).not.toHaveBeenCalled();
  finish({ body });
  await refreshFull(scope);
});

it('fills unknown muscle membership once instead of hiding valid filtered results', async () => {
  catalogStore().full(scope, body, new Date().toISOString());
  const selected = [
    { id: 2, name: 'Provider-confirmed muscle match', metrics: [] },
  ];
  page.mockResolvedValue({ body: { results: selected, count: 1 } });
  const filters = {
    query: '',
    commonMuscleGroup: 'Ноги',
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  const first = await listCatalog(new Headers(), scope.ownerId, filters);
  expect(first.items.map((item) => item.id)).toEqual([2]);
  expect(first.metadata).toMatchObject({ coverage: 'complete', total: 1 });
  expect(page).toHaveBeenCalledTimes(1);
  const repeated = await listCatalog(new Headers(), scope.ownerId, filters);
  expect(repeated.items.map((item) => item.id)).toEqual([2]);
  expect(page).toHaveBeenCalledTimes(1);
  expect(list).not.toHaveBeenCalled();
});
