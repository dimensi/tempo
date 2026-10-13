import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearPreviewRequests,
  requestPreview,
} from '@/features/workouts/preview-request';
const owner = 'synthetic-preview-owner';
const revision = 'a'.repeat(64);
beforeEach(() => {
  clearPreviewRequests(owner);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
it.each([404, 502])(
  'suppresses repeated owned endpoint requests after %i, retries at TTL or revision',
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));
    const first = requestPreview(owner, 501, revision, fetcher);
    expect(requestPreview(owner, 501, revision, fetcher)).toBe(first);
    expect(await first).toEqual({ state: 'unavailable' });
    for (let index = 0; index < 19; index++)
      await requestPreview(owner, 501, revision, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await requestPreview(owner, 501, 'b'.repeat(64), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    await requestPreview(owner, 501, revision, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);
it('shares an in-flight image but never retains successful private bytes', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      }),
  );
  const first = requestPreview(owner, 501, revision, fetcher);
  const second = requestPreview(owner, 501, revision, fetcher);
  expect(second).toBe(first);
  expect((await first).state).toBe('available');
  await requestPreview(owner, 501, revision, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]![0]).toBe(
    '/api/workouts/transformmate/exercises/501/preview?ownerId=synthetic-preview-owner',
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
});
it.each([401, 403])(
  'preserves %i denial and clears negative scope without a late image',
  async (status) => {
    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 502 }));
    await requestPreview(owner, 501, revision, failed);
    let release!: (response: Response) => void;
    const delayed = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const late = requestPreview(owner, 502, revision, delayed);
    await Promise.resolve();
    const denied = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));
    expect(await requestPreview(owner, 503, revision, denied)).toEqual({
      state: 'denied',
    });
    release(new Response(new Uint8Array([1])));
    expect(await late).toEqual({ state: 'denied' });
    await requestPreview(owner, 501, revision, failed);
    expect(failed).toHaveBeenCalledTimes(2);
  },
);
it('privacy intent fences pending responses and permits a fresh provider revision', async () => {
  let release!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(new Response(null, { status: 404 }));
  const late = requestPreview(owner, 501, revision, fetcher);
  await Promise.resolve();
  clearPreviewRequests(owner);
  release(new Response(new Uint8Array([1])));
  expect(await late).toEqual({ state: 'denied' });
  await requestPreview(owner, 501, 'c'.repeat(64), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
