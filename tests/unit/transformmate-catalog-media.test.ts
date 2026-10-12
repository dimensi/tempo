import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  listExercises: vi.fn(),
  getExercise: vi.fn(),
  assertCurrent: vi.fn(),
}));
vi.mock('@/server/auth/guards', () => ({ authorize: mocks.authorize }));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateConnectionFence: async () => ({
    client: mocks,
    generation: 'synthetic-connection',
    assertCurrent: mocks.assertCurrent,
  }),
}));
import {
  listExercises,
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
const signed = 'https://kinescopecdn.net/video.mp4?sign=private';
function detail() {
  const e = exerciseDetailFixture();
  e.kinescope_data[0]!.url = signed;
  return e;
}
beforeEach(() => {
  vi.resetAllMocks();
  invalidateTransformMateCatalog('owner');
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.getExercise.mockResolvedValue({ body: detail() });
  mocks.assertCurrent.mockResolvedValue(undefined);
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
    expect(await listExercises(new Headers(), 'owner', 'squ')).toEqual([
      { id: 1, name: 'Squat', canPlan: true },
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
});
describe('media proxy', () => {
  it.each([
    'http://kinescopecdn.net/x',
    'https://kinescopecdn.net.evil.test/x',
    'https://user@kinescopecdn.net/x',
    'https://127.0.0.1/x',
    'https://kinescopecdn.net:443/x#fragment',
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
    mocks.authorize
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const upstream = vi
      .fn()
      .mockResolvedValue(
        new Response('abc', { headers: { 'Content-Type': 'video/mp4' } }),
      );
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
    mocks.assertCurrent
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Connection changed'));
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
