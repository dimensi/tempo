import { afterEach, expect, it, vi } from 'vitest';
import { fetchWithDeadline } from '@/lib/fetch-with-deadline';
afterEach(() => vi.useRealTimers());
it('bounds a transport that never settles, including after abort', async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  const result = fetchWithDeadline('/', {}, 3000, async (_, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  const checked = expect(result).rejects.toMatchObject({
    name: 'TimeoutError',
  });
  await vi.advanceTimersByTimeAsync(3000);
  await checked;
  expect(requestSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('clears its timer after HTTP errors without classifying them as transport loss', async () => {
  vi.useFakeTimers();
  const response = new Response(null, { status: 503 });
  expect(await fetchWithDeadline('/', {}, 3000, async () => response)).toBe(
    response,
  );
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels a superseded request promptly without waiting for its deadline', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const result = fetchWithDeadline(
    '/',
    { signal: controller.signal },
    3000,
    async () => new Promise<Response>(() => {}),
  );
  const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});
