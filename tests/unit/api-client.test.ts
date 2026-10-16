import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  generation: 1,
  reset: vi.fn(),
  end: vi.fn(async () => {}),
}));
vi.mock('@/lib/session-state', () => ({
  sessionGeneration: () => state.generation,
  resetSession: state.reset,
}));
vi.mock('@/lib/local-logout', () => ({ endClientSession: state.end }));
beforeEach(() => {
  vi.resetModules();
  state.generation++;
  state.reset.mockClear();
  state.end.mockClear();
  vi.stubGlobal('location', { origin: 'https://app.test', replace: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
it('deduplicates equivalent GETs while one aborted observer does not cancel another', async () => {
  const response = Promise.withResolvers<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  );
  const { apiFetch } = await import('@/lib/api-client');
  const controller = new AbortController();
  const first = apiFetch('/api/unknown?b=2&a=1', { signal: controller.signal });
  const second = apiFetch('/api/unknown?a=1&b=2');
  const rejected = expect(first).rejects.toBeDefined();
  controller.abort();
  await rejected;
  response.resolve(Response.json({ value: 1 }));
  expect(await (await second).json()).toEqual({ value: 1 });
  expect(fetch).toHaveBeenCalledOnce();
});
it('an action forbidden response does not log out', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'FORBIDDEN' }, { status: 403 })),
  );
  const { apiFetch } = await import('@/lib/api-client');
  expect((await apiFetch('/api/action', { method: 'POST' })).status).toBe(403);
  expect(state.reset).not.toHaveBeenCalled();
  expect(state.end).not.toHaveBeenCalled();
});
it.each([
  [401, 'AUTH_REQUIRED'],
  [403, 'ACCESS_REVOKED'],
])('clears a current session for %s %s', async (status, error) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error }, { status })),
  );
  const { apiFetch } = await import('@/lib/api-client');
  await apiFetch('/api/action', { method: 'POST' });
  expect(state.reset).toHaveBeenCalledOnce();
  expect(state.end).toHaveBeenCalledExactlyOnceWith(false);
  expect(location.replace).toHaveBeenCalledWith('/login');
});
it('a late denial from a previous account cannot log out its replacement', async () => {
  const response = Promise.withResolvers<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  );
  const { apiFetch } = await import('@/lib/api-client');
  const flight = apiFetch('/api/action', { method: 'POST' });
  state.generation++;
  response.resolve(Response.json({ error: 'ACCESS_REVOKED' }, { status: 403 }));
  await flight;
  expect(state.end).not.toHaveBeenCalled();
  expect(state.reset).not.toHaveBeenCalled();
});
