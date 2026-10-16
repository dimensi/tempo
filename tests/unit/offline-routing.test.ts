import { afterEach, expect, it, vi } from 'vitest';
import {
  navigateWorkspace,
  interceptReadLinks,
  installServerNavigation,
  isWorkspaceRoute,
} from '@/lib/workspace-navigation';
import { reportNetworkResult } from '@/lib/network-state';
vi.mock('@/lib/client-read', () => ({ revalidateVisibleReads: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  reportNetworkResult(true);
});
function environment() {
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const scrollTo = vi.fn();
  vi.stubGlobal(
    'location',
    new URL('https://tempo.test/diary?date=2026-10-16'),
  );
  vi.stubGlobal('history', { pushState, replaceState });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo }));
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  return { pushState, replaceState, scrollTo };
}
it.each([
  '/',
  '/diary',
  '/workouts',
  '/measurements',
  '/analytics',
  '/settings',
  '/reports',
  '/anamnesis',
  '/workouts/sessions/one',
])('opens %s immediately without waiting for identity or RSC', (path) => {
  const env = environment();
  navigateWorkspace(path);
  expect(env.pushState).toHaveBeenCalledWith({}, '', path);
  expect(fetch).not.toHaveBeenCalled();
});
it('preserves scroll for date and filter changes', () => {
  const env = environment();
  navigateWorkspace('/diary?date=2026-10-15', { scroll: false });
  expect(env.scrollTo).not.toHaveBeenCalled();
});
it('uses the same route in both connection states', () => {
  const env = environment();
  reportNetworkResult(false);
  navigateWorkspace('/measurements');
  expect(env.pushState).toHaveBeenCalledWith({}, '', '/measurements');
  expect(fetch).not.toHaveBeenCalled();
});
it('explicitly reports an unavailable network action without navigating', () => {
  const env = environment();
  reportNetworkResult(false);
  const error = vi.fn();
  window.addEventListener('tempo:action-unavailable', error);
  navigateWorkspace('/workouts/new');
  expect(error).toHaveBeenCalledOnce();
  expect(env.pushState).not.toHaveBeenCalled();
});
it('delegates authorized network routes to the server router', () => {
  environment();
  const server = vi.fn();
  const stop = installServerNavigation(server);
  navigateWorkspace('/workouts/new', { scroll: false });
  expect(server).toHaveBeenCalledWith('/workouts/new', { scroll: false });
  stop();
});
it('leaves modified, hash, external and prevented links alone', () => {
  environment();
  let click!: (event: MouseEvent) => void;
  vi.stubGlobal('document', {
    addEventListener: (_: string, listener: typeof click) => {
      click = listener;
    },
    removeEventListener: vi.fn(),
  });
  const stop = interceptReadLinks();
  for (const options of [
    { metaKey: true },
    { defaultPrevented: true },
    { href: 'https://example.com' },
    { href: 'https://tempo.test/diary?date=2026-10-16#meal' },
  ]) {
    const preventDefault = vi.fn();
    click({
      button: 0,
      target: { closest: () => ({ href: 'https://tempo.test/', ...options }) },
      preventDefault,
      ...options,
    } as unknown as MouseEvent);
    expect(preventDefault).not.toHaveBeenCalled();
  }
  stop();
});
it('does not treat editor routes as read routes', () => {
  expect(isWorkspaceRoute('/workouts/new')).toBe(false);
  expect(isWorkspaceRoute('/workouts/plans/p/edit')).toBe(false);
  expect(isWorkspaceRoute('/workouts/plans/p/workouts/w/results')).toBe(false);
});
