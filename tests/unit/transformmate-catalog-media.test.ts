import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  listExercises: vi.fn(),
  getExercise: vi.fn(),
  listExercisePage: vi.fn(),
  database: null as ReturnType<
    typeof import('@/server/db/connection').openDatabase
  > | null,
  assertCurrent: vi.fn(),
  assertBindingCurrent: vi.fn(),
}));
vi.mock('@/server/db', () => ({ getDatabase: () => mocks.database }));
vi.mock('@/server/auth/guards', () => ({ authorize: mocks.authorize }));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateConnectionFence: async () => ({
    client: mocks,
    generation: 'synthetic-connection',
    accountScope: 'synthetic-account',
    assertCurrent: mocks.assertCurrent,
    assertBindingCurrent: mocks.assertBindingCurrent,
  }),
}));
import {
  listCatalog,
  exerciseInfo,
  catalogResponse,
} from '@/server/transformmate/catalog';
import {
  streamExerciseVideo,
  selectMediaUrl,
} from '@/server/transformmate/media';
import {
  canPlanExercise,
  transformMateCatalogSchema,
} from '@/server/transformmate/catalog-schema';
import { invalidateTransformMateCatalog } from '@/server/transformmate/catalog-cache';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
async function listExercises(headers: Headers, ownerId: string, query: string) {
  return (
    await listCatalog(headers, ownerId, {
      query,
      commonMuscleGroup: null,
      muscleGroups: [],
      offset: 0,
      limit: 50,
    })
  ).items;
}
const signed = 'https://kinescopecdn.net/video.mp4?sign=private';
function detail() {
  const e = exerciseDetailFixture();
  e.kinescope_data[0]!.url = signed;
  return e;
}
import { projectDetail } from '@/server/transformmate/catalog-projection';
import { catalogStore } from '@/server/transformmate/catalog-store';
import { openDatabase } from '@/server/db/connection';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { user } from '@/server/db/schema';
afterEach(() => {
  mocks.database?.sqlite.close();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.database = openDatabase('file::memory:');
  migrate(mocks.database.db, { migrationsFolder: './drizzle' });
  mocks.database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic',
      role: 'OWNER',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  mocks.listExercisePage.mockImplementation(
    async ({ search, offset, limit }) => {
      const { body } = await mocks.listExercises();
      const matches = body.filter((row: { name: string }) =>
        row.name.toLowerCase().includes(search),
      );
      return {
        body: {
          results: matches.slice(offset, offset + limit),
          count: matches.length,
        },
      };
    },
  );
  invalidateTransformMateCatalog('owner');
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.getExercise.mockResolvedValue({ body: detail() });
  mocks.assertCurrent.mockResolvedValue(undefined);
  mocks.assertBindingCurrent.mockImplementation(() => undefined);
});
describe('private catalog', () => {
  it('only projects bounded public fields and confirmed metrics', async () => {
    const metrics = [
      { id: 3, key: 'weight' },
      { id: 4, key: 'reps' },
    ];
    mocks.listExercises.mockResolvedValue({
      body: [
        { id: 1, name: 'Squat', metrics, secret: signed },
        { id: 2, name: 'Run', metrics: [] },
      ],
    });
    expect(await listExercises(new Headers(), 'owner', 'squ')).toMatchObject([
      {
        id: 1,
        name: 'Squat',
        canPlan: true,
        publicationCapability: { state: 'unknown', reason: null },
        detailCoverage: 'unknown',
      },
    ]);
    expect(
      canPlanExercise({ metrics: [...metrics, { id: 5, key: 'time' }] }),
    ).toBe(false);
    expect(
      transformMateCatalogSchema.safeParse([
        { id: 1, name: 'x'.repeat(501), metrics: [] },
      ]).success,
    ).toBe(false);
    expect(
      JSON.stringify(await exerciseInfo(new Headers(), 'owner', 501)),
    ).not.toContain(signed);
  });
  it('requires access before and after network work', async () => {
    mocks.authorize
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    mocks.listExercises.mockResolvedValue({ body: [] });
    await expect(
      listExercises(new Headers(), 'owner', ''),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.authorize).toHaveBeenNthCalledWith(
      3,
      expect.any(Headers),
      'workouts:read',
      'owner',
    );
  });
  it.each(['disconnect', 'reconnect'] as const)(
    'does not release a cached catalog after %s during final authorization',
    async () => {
      let stale = false;
      mocks.listExercises.mockResolvedValue({ body: [] });
      mocks.authorize
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true })
        .mockImplementationOnce(async () => {
          stale = true;
          return { ok: true };
        });
      mocks.assertBindingCurrent.mockImplementation(() => {
        if (stale) throw new Error('TransformMate connection changed');
      });

      await expect(listExercises(new Headers(), 'owner', '')).rejects.toThrow(
        'TransformMate connection changed',
      );
      expect(mocks.assertBindingCurrent).toHaveBeenCalled();
    },
  );
  it.each(['disconnect', 'reconnect'] as const)(
    'does not release exercise detail after %s during final authorization',
    async () => {
      let stale = false;
      mocks.authorize
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true })
        .mockImplementationOnce(async () => {
          stale = true;
          return { ok: true };
        });
      mocks.assertBindingCurrent.mockImplementation(() => {
        if (stale) throw new Error('TransformMate connection changed');
      });

      await expect(exerciseInfo(new Headers(), 'owner', 501)).rejects.toThrow(
        'TransformMate connection changed',
      );
      expect(mocks.assertBindingCurrent).toHaveBeenCalled();
    },
  );
});
describe('media proxy', () => {
  it.each([
    'http://kinescopecdn.net/x',
    'https://kinescopecdn.net.evil.test/x',
    'https://user@kinescopecdn.net/x',
    'https://127.0.0.1/x',
    'https://kinescopecdn.net:443/x#fragment',
    'https://kinescopecdn.net:443/x',
  ])('rejects unsafe URL %s', (url) => {
    expect(selectMediaUrl({ kinescope_data: [{ url }] })).toBeNull();
  });
  it('streams range with only safe headers', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response('abc', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-2/3',
          Location: signed,
          'Set-Cookie': 'secret=x',
        },
      }),
    );
    const response = await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner', {
        headers: {
          Range: 'bytes=0-2',
          Authorization: 'secret',
          Cookie: 'session=secret',
        },
      }),
      '501',
      upstream,
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('abc');
    expect(upstream.mock.calls[0]![1]).toMatchObject({
      headers: { Range: 'bytes=0-2' },
      redirect: 'error',
    });
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('does not fetch after denied authorization', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
    const upstream = vi.fn();
    expect(
      (
        await streamExerciseVideo(
          new Request('https://app.test/video?ownerId=owner'),
          '501',
          upstream,
        )
      ).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('discards stream if access revoked while media fetch awaits', async () => {
    const upstream = vi.fn().mockImplementation(async () => {
      mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
      return new Response('abc', { headers: { 'Content-Type': 'video/mp4' } });
    });
    expect(
      (
        await streamExerciseVideo(
          new Request('https://app.test/video?ownerId=owner'),
          '501',
          upstream,
        )
      ).status,
    ).toBe(403);
  });
  it('supports HEAD and rejects redirects or malformed ranges', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': '3' },
      }),
    );
    const head = await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner', { method: 'HEAD' }),
      '501',
      upstream,
    );
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(upstream.mock.calls[0]![1].method).toBe('HEAD');
    upstream.mockRejectedValue(new Error(signed));
    const redirect = await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner'),
      '501',
      upstream,
    );
    expect(redirect.status).toBe(502);
    expect(await redirect.text()).not.toContain(signed);
    upstream.mockClear();
    expect(
      (
        await streamExerciseVideo(
          new Request('https://app.test/video?ownerId=owner', {
            headers: { Range: 'bytes=0-1,4-5' },
          }),
          '501',
          upstream,
        )
      ).status,
    ).toBe(416);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('cancels fetched media if the connection changes before response', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    const upstream = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { headers: { 'Content-Type': 'video/mp4' } }),
      );
    upstream.mockImplementation(async () => {
      mocks.assertCurrent.mockRejectedValue(new Error('Connection changed'));
      return new Response(body, { headers: { 'Content-Type': 'video/mp4' } });
    });
    const response = await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner'),
      '501',
      upstream,
    );
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(await response.text()).toBe('');
  });
});

import { createTransformMateClient } from '@/server/transformmate/client';
describe('bounded upstream JSON', () => {
  it('rejects an oversized declared response without consuming it', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) },
    });
    const client = createTransformMateClient({
      baseUrl: 'https://example.test/',
      tokenProvider: { getIdToken: async () => 'synthetic' },
      fetch: vi.fn().mockResolvedValue(response),
    });
    await expect(client.listExercises()).rejects.toThrow(
      'TransformMate request or response read failed',
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels oversized chunked responses without exposing payload', async () => {
    const cancel = vi.fn();
    let sent = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          sent++;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel,
      }),
    );
    const client = createTransformMateClient({
      baseUrl: 'https://example.test/',
      tokenProvider: { getIdToken: async () => 'synthetic' },
      fetch: vi.fn().mockResolvedValue(response),
    });
    await expect(client.listExercises()).rejects.toThrow(
      'TransformMate request or response read failed',
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(sent).toBeLessThanOrEqual(18);
  });
});

describe('bounded search and localized errors', () => {
  it('limits matched results to 50', async () => {
    mocks.listExercises.mockResolvedValue({
      body: Array.from({ length: 70 }, (_, id) => ({
        id: id + 1,
        name: 'Squat',
        metrics: [],
      })),
    });
    expect(await listExercises(new Headers(), 'owner', 'squ')).toHaveLength(50);
  });
  it('uses a Russian error without upstream details', async () => {
    const response = await catalogResponse(async () => {
      throw new Error(signed);
    });
    expect(await response.json()).toEqual({
      error: 'Не удалось загрузить данные TransformMate. Попробуйте позже.',
    });
  });
});
describe('range response validation and cancellation', () => {
  it.each([
    null,
    'bytes */30',
    'bytes 5-2/30',
    'bytes 0-30/30',
    'bytes 0-2/*',
    'bytes 0-2/9007199254740992',
  ])('rejects invalid 206 range %s', async (contentRange) => {
    const headers = new Headers({ 'Content-Type': 'video/mp4' });
    if (contentRange) headers.set('Content-Range', contentRange);
    const upstream = vi
      .fn()
      .mockResolvedValue(new Response('abc', { status: 206, headers }));
    expect(
      (
        await streamExerciseVideo(
          new Request('https://app.test/video?ownerId=owner', {
            headers: { Range: 'bytes=0-2' },
          }),
          '501',
          upstream,
        )
      ).status,
    ).toBe(502);
  });
  it('rejects unsolicited 206 responses', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response('abc', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-2/30',
        },
      }),
    );
    expect(
      (
        await streamExerciseVideo(
          new Request('https://app.test/video?ownerId=owner'),
          '501',
          upstream,
        )
      ).status,
    ).toBe(502);
  });
  it('strips upstream error-body length on 416', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response('error payload', {
        status: 416,
        headers: {
          'Content-Length': '13',
          'Content-Range': 'bytes */30',
          'Content-Type': 'text/plain',
        },
      }),
    );
    const response = await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner', {
        headers: { Range: 'bytes=50-' },
      }),
      '501',
      upstream,
    );
    expect(response.status).toBe(416);
    expect(response.body).toBeNull();
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.get('content-range')).toBe('bytes */30');
    expect(response.headers.has('content-type')).toBe(false);
  });
  it('forwards client abort to upstream fetch', async () => {
    const abort = new AbortController();
    let signal: AbortSignal | undefined;
    const upstream = vi.fn().mockImplementation(async (_url, init) => {
      signal = init.signal;
      abort.abort();
      return new Response(null, { headers: { 'Content-Type': 'video/mp4' } });
    });
    await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner', {
        signal: abort.signal,
      }),
      '501',
      upstream,
    );
    expect(signal?.aborted).toBe(true);
  });
});

describe('truthful persistent catalog metadata', () => {
  const filters = {
    query: '',
    commonMuscleGroup: null,
    muscleGroups: [],
    offset: 0,
    limit: 50,
  };
  it('cold upstream failure remains unknown/unavailable with nullable count', async () => {
    mocks.listExercises.mockRejectedValue(new Error('upstream unavailable'));
    const result = await listCatalog(new Headers(), 'owner', filters);
    expect(result).toMatchObject({
      items: [],
      metadata: {
        coverage: 'unknown',
        refreshState: 'unavailable',
        total: null,
        fetchedAt: null,
      },
    });
    const response = await catalogResponse(async () => result, true);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.catalog.coverage).toBe('unknown');
  });
  it('warm stale data survives refresh failure, retaining original fetched time', async () => {
    const at = '2020-01-01T00:00:00.000Z';
    catalogStore().full(
      {
        ownerId: 'owner',
        accountScope: 'synthetic-account',
        generation: 'synthetic-connection',
        locale: 'ru',
      },
      [{ id: 1, name: 'Existing exercise', metrics: [] }],
      at,
    );
    mocks.listExercises.mockRejectedValue(new Error('upstream unavailable'));
    const result = await listCatalog(new Headers(), 'owner', filters);
    expect(result.items[0]?.name).toBe('Existing exercise');
    expect(result.metadata).toMatchObject({
      fetchedAt: at,
      stale: true,
      coverage: 'complete',
    });
    expect(
      (await listCatalog(new Headers(), 'owner', filters)).metadata
        .refreshState,
    ).toBe('unavailable');
  });
  it('forwards exact dictionary names and canonicalizes subgroup union without guessing IDs', async () => {
    mocks.listExercisePage.mockResolvedValue({
      body: { results: [], count: 0 },
    });
    const result = await listCatalog(new Headers(), 'owner', {
      ...filters,
      query: ' Присед ',
      commonMuscleGroup: 'Ноги',
      muscleGroups: ['Квадрицепс', 'Бицепс бедра', 'Квадрицепс'],
    });
    expect(mocks.listExercisePage).toHaveBeenCalledWith({
      search: 'присед',
      commonMuscleGroup: 'Ноги',
      muscleGroups: ['Бицепс бедра', 'Квадрицепс'],
      offset: 0,
      limit: 50,
    });
    expect(result.metadata).toMatchObject({ coverage: 'complete', total: 0 });
  });
  it('uses persisted video metadata across HEAD/GET and refreshes expiry at most once', async () => {
    const upstream = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(null, { headers: { 'Content-Type': 'video/mp4' } }),
      );
    await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner', { method: 'HEAD' }),
      '501',
      upstream,
    );
    await streamExerciseVideo(
      new Request('https://app.test/video?ownerId=owner'),
      '501',
      upstream,
    );
    expect(mocks.getExercise).toHaveBeenCalledTimes(1);
    upstream
      .mockReset()
      .mockImplementation(async () => new Response(null, { status: 403 }));
    expect(
      (
        await streamExerciseVideo(
          new Request('https://app.test/video?ownerId=owner'),
          '501',
          upstream,
        )
      ).status,
    ).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(mocks.getExercise).toHaveBeenCalledTimes(2);
  });
});

it('local subgroup union intersects common-group membership independently across actual muscles', async () => {
  const identity = {
    ownerId: 'owner',
    accountScope: 'synthetic-account',
    generation: 'synthetic-connection',
    locale: 'ru' as const,
  };
  const at = new Date().toISOString();
  const base = exerciseDetailFixture();
  catalogStore().dictionary(
    identity,
    [
      {
        id: 13,
        name: 'Subgroup A',
        commonGroup: { id: 1, name: 'Upper' },
        muscleIds: [20],
      },
      {
        id: 14,
        name: 'Subgroup B',
        commonGroup: { id: 2, name: 'Legs' },
        muscleIds: [21],
      },
    ],
    at,
  );
  catalogStore().detail(
    identity,
    projectDetail({
      ...base,
      muscles: [
        {
          ...base.muscles[0]!,
          muscle: {
            ...base.muscles[0]!.muscle,
            muscle_group: { id: 13, name: 'Subgroup A', image: null },
          },
        },
        {
          ...base.muscles[0]!,
          muscle: {
            ...base.muscles[0]!.muscle,
            id: 21,
            muscle_group: { id: 14, name: 'Subgroup B', image: null },
          },
        },
      ],
    }),
    at,
  );
  mocks.listExercisePage.mockRejectedValue(new Error('temporary outage'));
  const result = await listCatalog(new Headers(), 'owner', {
    query: '',
    commonMuscleGroup: 'Legs',
    muscleGroups: ['Subgroup A'],
    offset: 0,
    limit: 50,
  });
  expect(result.items.map((item) => item.id)).toEqual([501]);
  expect(result.metadata).toMatchObject({
    coverage: 'partial',
    total: null,
    refreshState: 'unavailable',
  });
});
