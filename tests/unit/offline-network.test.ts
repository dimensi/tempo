import { afterEach, expect, it, vi } from 'vitest';
import { observeOfflineDenials } from '@/lib/offline-device';
import { networkStatusEvent } from '@/lib/network-state';
afterEach(() => vi.unstubAllGlobals());
function windowDouble(request: typeof fetch) {
  const target = Object.assign(new EventTarget(), {
    fetch: request,
    location: new URL('https://tempo.example.test'),
  });
  vi.stubGlobal('window', target);
  const statuses: boolean[] = [];
  let loaded = 0;
  target.addEventListener(networkStatusEvent, (event) =>
    statuses.push((event as CustomEvent<boolean>).detail),
  );
  target.addEventListener('tempo:offline-source-loaded', () => loaded++);
  const stop = observeOfflineDenials();
  return { target, statuses, loaded: () => loaded, stop };
}
it('uses actual request failures and does not mistake aborted reads for connectivity loss', async () => {
  const env = windowDouble(
    vi.fn(async () => {
      throw new TypeError('Network down');
    }),
  );
  await expect(env.target.fetch('/api/measurements')).rejects.toThrow();
  expect(env.statuses).toEqual([false]);
  const pending = new AbortController();
  pending.abort();
  await expect(
    env.target.fetch('/api/measurements', { signal: pending.signal }),
  ).rejects.toThrow();
  expect(env.statuses).toEqual([false]);
  env.stop();
});
it('successful data loads signal refresh while offline API/media cannot create refresh loops', async () => {
  const env = windowDouble(vi.fn(async () => new Response('{}')));
  await env.target.fetch('/api/measurements?ownerId=owner');
  await env.target.fetch('/api/offline/snapshot');
  await env.target.fetch('/api/workouts/transformmate/exercises/123/video');
  expect(env.statuses).toEqual([true, true, true]);
  expect(env.loaded()).toBe(1);
  env.stop();
});
it('server unavailability is reported even when the network interface is present', async () => {
  const env = windowDouble(
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
  await env.target.fetch('/api/overview');
  expect(env.statuses).toEqual([false]);
  expect(env.loaded()).toBe(0);
  env.stop();
});
