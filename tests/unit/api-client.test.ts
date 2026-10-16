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
vi.mock('@/lib/client-read', () => ({
  seedClientRead: vi.fn(),
  canonicalReadKey: (url: URL) => {
    url.searchParams.sort();
    return url.pathname + url.search;
  },
}));
beforeEach(() => {
  vi.resetModules();
  state.generation++;
  state.reset.mockClear();
  state.end.mockClear();
  vi.stubGlobal('navigator', { onLine: true });
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
  const first = apiFetch('/api/settings/steps-goal?to=2&from=1', {
    signal: controller.signal,
  });
  const second = apiFetch('/api/settings/steps-goal?from=1&to=2');
  const rejected = expect(first).rejects.toBeDefined();
  controller.abort();
  await rejected;
  response.resolve(Response.json({ dailyStepsGoal: 1 }));
  expect(await (await second).json()).toEqual({ dailyStepsGoal: 1 });
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
  // endClientSession owns the synchronous reset and durable logout intent.
  expect(state.reset).not.toHaveBeenCalled();
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

it('a denial body arriving after account replacement cannot reset or redirect it', async () => {
  const body = Promise.withResolvers<unknown>();
  const parsing = Promise.withResolvers<void>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: 403,
      ok: false,
      clone: () => ({
        json: () => {
          parsing.resolve();
          return body.promise;
        },
      }),
    })),
  );
  const { apiFetch } = await import('@/lib/api-client');
  const flight = apiFetch('/api/action', { method: 'POST' });
  await parsing.promise;
  state.generation++;
  body.resolve({ error: 'ACCESS_REVOKED' });
  await flight;
  expect(state.end).not.toHaveBeenCalled();
  expect(state.reset).not.toHaveBeenCalled();
  expect(location.replace).not.toHaveBeenCalled();
});
it('a download keeps its caller deadline through a slow response body', async () => {
  const timeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
    timeout(ms === 15000 ? 5 : ms),
  );
  const caller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, init?: RequestInit) => {
      const signal = init?.signal;
      const stream = new ReadableStream({
        start(controller) {
          const abort = () => controller.error(signal?.reason);
          signal?.addEventListener('abort', abort, { once: true });
          setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            if (!signal?.aborted) {
              controller.enqueue(new TextEncoder().encode('%PDF-complete'));
              controller.close();
            }
          }, 30);
        },
      });
      return new Response(stream);
    }),
  );
  try {
    const { apiFetch } = await import('@/lib/api-client');
    const response = await apiFetch(
      '/api/anamnesis/documents/doc/file?ownerId=owner',
      { signal: caller.signal },
    );
    expect(await response.text()).toBe('%PDF-complete');
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: caller.signal }),
    );
    expect(caller.signal.aborted).toBe(false);
  } finally {
    vi.restoreAllMocks();
  }
});
