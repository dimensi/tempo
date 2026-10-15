import { afterEach, expect, it, vi } from 'vitest';
import { observeOfflineDenials } from '@/lib/offline-device';
import {
  networkStatusEvent,
  reportNetworkResult,
  networkReachable,
} from '@/lib/network-state';
afterEach(() => {
  vi.unstubAllGlobals();
  reportNetworkResult(true);
});
function windowDouble(request: typeof fetch) {
  reportNetworkResult(true);
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
  expect(env.statuses).toEqual([]);
  expect(networkReachable()).toBe(true);
  expect(env.loaded()).toBe(1);
  env.stop();
});
it('cache preparation HTTP failures do not report loss of transport', async () => {
  const env = windowDouble(
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
  await env.target.fetch('/api/offline/identity');
  expect(env.statuses).toEqual([]);
  expect(networkReachable()).toBe(true);
  expect(env.loaded()).toBe(0);
  env.stop();
});
it('refreshes safe settings after successful goal reads and saves', async () => {
  const env = windowDouble(
    vi.fn(async () => Response.json({ dailyStepsGoal: 10000 })),
  );
  await env.target.fetch('/api/settings/steps-goal');
  await env.target.fetch('/api/settings/steps-goal', { method: 'PUT' });
  expect(env.loaded()).toBe(2);
  env.stop();
});
it('keeps feature and cache HTTP failures local to their resources', async () => {
  const responses = [
    Response.json({ error: 'Renderer unavailable' }, { status: 503 }),
    new Response('Gateway unavailable', { status: 503 }),
  ];
  const env = windowDouble(vi.fn(async () => responses.shift()!));
  await env.target.fetch('/api/overview');
  await env.target.fetch('/api/offline/snapshot');
  expect(env.statuses).toEqual([]);
  expect(networkReachable()).toBe(true);
  expect(env.loaded()).toBe(0);
  env.stop();
});
it('does not confuse provider or snapshot HTTP errors with lost connectivity', async () => {
  const env = windowDouble(
    vi.fn(async () =>
      Response.json({ error: 'Service unavailable' }, { status: 503 }),
    ),
  );
  await env.target.fetch('/api/workouts/transformmate/exercises?q=manual');
  await env.target.fetch('/api/offline/snapshot');
  expect(env.statuses).toEqual([]);
  expect(networkReachable()).toBe(true);
  expect(env.loaded()).toBe(0);
  env.stop();
});

it('recovers on an HTTP response and emits only actual transport state changes', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Network down'))
    .mockResolvedValue(
      Response.json({ error: 'OFFLINE_UNAVAILABLE' }, { status: 503 }),
    );
  const env = windowDouble(request);
  await expect(env.target.fetch('/api/overview')).rejects.toThrow();
  await env.target.fetch('/api/offline/snapshot');
  await env.target.fetch('/api/offline/anamnesis');
  expect(env.statuses).toEqual([false, true]);
  expect(networkReachable()).toBe(true);
  env.stop();
});
