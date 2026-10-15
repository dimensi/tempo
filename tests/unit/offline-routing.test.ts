import { afterEach, expect, it, vi } from 'vitest';
import {
  interceptOfflineLinks,
  isOfflineRoute,
  offlineNavigate,
} from '@/lib/offline-routing';
import { reportNetworkResult } from '@/lib/network-state';
import { purgeOfflineDevice } from '@/lib/offline-device';
import { ownerConfirmedYazioWeightPolicyVersion } from '@/contracts/yazio-weight-policy';

vi.mock('@/lib/offline-device', () => ({
  purgeOfflineDevice: vi.fn(async () => {}),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(purgeOfflineDevice).mockClear();
  reportNetworkResult(true);
});

it('preserves scroll when cached navigation requests it', () => {
  const pushState = vi.fn();
  const scrollTo = vi.fn();
  vi.stubGlobal('location', new URL('https://tempo.test/diary'));
  vi.stubGlobal('history', { pushState });
  vi.stubGlobal('window', { scrollTo });
  offlineNavigate('/diary?date=2026-10-16', false, false);
  expect(pushState).toHaveBeenCalledOnce();
  expect(scrollTo).not.toHaveBeenCalled();
});
it.each([
  '/',
  '/diary',
  '/anamnesis',
  '/workouts/plans/one/edit',
  '/workouts/sessions/one',
  '/workouts/new',
])('keeps %s local until both interface and server are reachable', (path) => {
  let click!: (event: MouseEvent) => void;
  const pushState = vi.fn();
  vi.stubGlobal('document', {
    addEventListener: (_: string, fn: typeof click) => {
      click = fn;
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { scrollTo: vi.fn() }),
  );
  vi.stubGlobal('location', new URL('https://tempo.test/workouts'));
  vi.stubGlobal('history', { pushState });
  vi.stubGlobal('navigator', { onLine: true });
  const cleanup = interceptOfflineLinks();
  const preventDefault = vi.fn();
  const event = {
    button: 0,
    target: { closest: () => ({ href: `https://tempo.test${path}` }) },
    preventDefault,
  } as unknown as MouseEvent;
  reportNetworkResult(false);
  click(event);
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(pushState).toHaveBeenCalledWith({ tempoOfflineRoute: path }, '', path);

  cleanup();
});

it('matches a saved route to its exact URL so ordinary navigation cannot inherit it', () => {
  vi.stubGlobal('history', {
    state: { tempoOfflineRoute: '/diary?date=2026-10-15' },
  });
  expect(
    isOfflineRoute(new URL('https://tempo.test/diary?date=2026-10-15')),
  ).toBe(true);
  expect(isOfflineRoute(new URL('https://tempo.test/'))).toBe(false);
  expect(
    isOfflineRoute(new URL('https://tempo.test/diary?date=2026-10-14')),
  ).toBe(false);
  expect(isOfflineRoute(null)).toBe(false);
});

function navigationDouble(
  hasSaved: (url: URL) => boolean = () => false,
  expectedIdentity?: () => {
    partition: string;
    connectionGeneration: string;
    role: 'OWNER' | 'TRAINER';
  },
) {
  let click!: (event: MouseEvent) => void;
  const pushState = vi.fn();
  const navigate = vi.fn();
  vi.stubGlobal('document', {
    addEventListener: (_: string, fn: typeof click) => {
      click = fn;
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { scrollTo: vi.fn() }),
  );
  vi.stubGlobal('location', new URL('https://tempo.test/diary'));
  vi.stubGlobal('history', { pushState });
  vi.stubGlobal('navigator', { onLine: true });
  const stop = interceptOfflineLinks(hasSaved, undefined, expectedIdentity);
  return {
    pushState,
    navigate,
    stop,
    click: (path: string, extras = {}) => {
      const preventDefault = vi.fn();
      click({
        button: 0,
        target: {
          closest: () => ({
            href: `https://tempo.test${path}`,
            click: () => navigate(path),
          }),
        },
        preventDefault,
        ...extras,
      } as unknown as MouseEvent);
      return preventDefault;
    },
  };
}
it('shows a saved destination before identity and RSC settle', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const env = navigationDouble((url) => url.pathname === '/analytics');
  env.click('/analytics');
  expect(env.pushState).toHaveBeenCalledWith(
    { tempoOfflineRoute: '/analytics' },
    '',
    '/analytics',
  );
  expect(env.navigate).not.toHaveBeenCalled();

  release(new Response('{}'));
  await vi.waitFor(() =>
    expect(env.navigate).toHaveBeenCalledWith('/analytics'),
  );
  env.stop();
});
it.each([401, 403, 409])(
  'does not resume live navigation after identity denial %s',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    const env = navigationDouble(() => true);
    env.click('/analytics');
    await Promise.resolve();
    await Promise.resolve();
    expect(env.pushState).toHaveBeenCalledOnce();
    expect(env.navigate).not.toHaveBeenCalled();
    if (status === 409)
      await vi.waitFor(() => expect(purgeOfflineDevice).toHaveBeenCalledOnce());
    else expect(purgeOfflineDevice).not.toHaveBeenCalled();
    env.stop();
  },
);
it('resumes a verified captured link without replaying its click', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  const resumeVerified = vi.fn();
  let click!: (event: MouseEvent) => void;
  const replay = vi.fn();
  vi.stubGlobal('document', {
    addEventListener: (_: string, fn: typeof click) => {
      click = fn;
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', new URL('https://tempo.test/diary'));
  vi.stubGlobal('navigator', { onLine: true });
  const stop = interceptOfflineLinks(() => false, resumeVerified);
  click({
    button: 0,
    target: {
      closest: () => ({
        href: 'https://tempo.test/anamnesis',
        click: replay,
      }),
    },
    preventDefault: vi.fn(),
  } as unknown as MouseEvent);
  await vi.waitFor(() =>
    expect(resumeVerified).toHaveBeenCalledWith(
      new URL('https://tempo.test/anamnesis'),
    ),
  );
  expect(fetch).toHaveBeenCalledOnce();
  expect(replay).not.toHaveBeenCalled();
  stop();
});
it('purges instead of resuming when a successful identity belongs to another fence', async () => {
  const previous = {
    partition: 'a'.repeat(43),
    connectionGeneration: 'b'.repeat(43),
    role: 'OWNER' as const,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        contractVersion: 2,
        weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
        partition: 'c'.repeat(43),
        connectionGeneration: 'd'.repeat(43),
        role: 'OWNER',
        serverNow: '2026-10-16T12:00:00.000Z',
        sessionExpiresAt: '2026-10-16T13:00:00.000Z',
        expiresAt: '2026-10-16T13:00:00.000Z',
      }),
    ),
  );
  const env = navigationDouble(
    () => true,
    () => previous,
  );
  env.click('/analytics');
  await vi.waitFor(() => expect(purgeOfflineDevice).toHaveBeenCalledOnce());
  expect(env.navigate).not.toHaveBeenCalled();
  env.stop();
});
it('keeps the current screen until an actual response allows live navigation', async () => {
  const request = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', request);
  const env = navigationDouble();
  env.click('/');
  expect(env.navigate).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(env.navigate).toHaveBeenCalledWith('/'));
  expect(env.pushState).not.toHaveBeenCalled();
  env.stop();
});
it('opens saved data when onLine stays true and the transport never settles', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Promise<Response>(() => {})),
  );
  const env = navigationDouble();
  env.click('/');
  await vi.advanceTimersByTimeAsync(2001);
  expect(env.navigate).not.toHaveBeenCalled();
  expect(env.pushState).toHaveBeenCalledWith(
    { tempoOfflineRoute: '/' },
    '',
    '/',
  );
  env.stop();
});
it('only the latest navigation can commit after slow responses', async () => {
  const releases: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => releases.push(resolve))),
  );
  const env = navigationDouble();
  env.click('/');
  env.click('/analytics');
  releases[1]!(new Response('{}'));
  await vi.waitFor(() =>
    expect(env.navigate).toHaveBeenCalledWith('/analytics'),
  );
  releases[0]!(new Response('{}'));
  await Promise.resolve();
  expect(env.navigate).toHaveBeenCalledTimes(1);
  expect(env.pushState).not.toHaveBeenCalled();
  env.stop();
});
it('leaves hash, modified clicks and prevented events alone', () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  const env = navigationDouble();
  expect(env.click('/diary#details')).not.toHaveBeenCalled();
  expect(env.click('/', { metaKey: true })).not.toHaveBeenCalled();
  expect(env.click('/', { defaultPrevented: true })).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  env.stop();
});
it('Back cancels a pending probe so its response cannot navigate forward again', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const env = navigationDouble();
  env.click('/');
  window.dispatchEvent(new Event('popstate'));
  release(new Response('{}'));
  await Promise.resolve();
  await Promise.resolve();
  expect(env.navigate).not.toHaveBeenCalled();
  expect(env.pushState).not.toHaveBeenCalled();
  env.stop();
});
