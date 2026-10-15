import { afterEach, expect, it, vi } from 'vitest';
import {
  interceptOfflineLinks,
  isOfflineRoute,
} from '@/lib/offline-routing';
import { reportNetworkResult } from '@/lib/network-state';

afterEach(() => {
  vi.unstubAllGlobals();
  reportNetworkResult(true);
});
it.each([
  '/',
  '/diary',
  '/anamnesis',
  '/workouts/one/edit',
  '/workouts/one/results',
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
  vi.stubGlobal('window', { scrollTo: vi.fn(), dispatchEvent: vi.fn() });
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
  reportNetworkResult(true);
  click(event);
  expect(preventDefault).toHaveBeenCalledOnce();
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
