'use client';
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { revalidateVisibleReads } from './client-read';
import { networkReachable } from './network-state';
export function isWorkspaceRoute(path: string) {
  return (
    [
      '/',
      '/diary',
      '/workouts',
      '/measurements',
      '/analytics',
      '/reports',
      '/settings',
      '/anamnesis',
      '/workouts/catalog',
    ].includes(path) ||
    /^\/anamnesis\/(markers|documents)\/[^/]+$/.test(path) ||
    /^\/workouts\/(plans\/[^/]+\/workouts\/[^/]+|sessions\/[^/]+|native\/[1-9][0-9]*|links\/[^/]+)$/.test(
      path,
    )
  );
}
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
  window.dispatchEvent(new Event('tempo:read-location-change'));
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
};
const current = () => location.pathname + location.search;
export function useReadLocation() {
  return useSyncExternalStore(subscribe, current, () => '');
}
const RouteLocation = createContext<string | null>(null);
export function ReadLocationProvider({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <RouteLocation.Provider value={href}>{children}</RouteLocation.Provider>
  );
}
export function useReadSearchParams() {
  const route = useContext(RouteLocation);
  const location = useReadLocation();
  return useMemo(
    () => new URL(route ?? location, 'https://tempo.local').searchParams,
    [route, location],
  );
}
let serverNavigate:
  | ((href: string, options?: { replace?: boolean; scroll?: boolean }) => void)
  | undefined;
export function installServerNavigation(value: typeof serverNavigate) {
  serverNavigate = value;
  return () => {
    if (serverNavigate === value) serverNavigate = undefined;
  };
}
export function navigateWorkspace(
  href: string,
  options: { replace?: boolean; scroll?: boolean } = {},
) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) {
    location.assign(url.href);
    return;
  }
  if (!isWorkspaceRoute(url.pathname)) {
    if (!navigator.onLine || !networkReachable()) {
      window.dispatchEvent(new Event('tempo:action-unavailable'));
      return;
    }
    if (serverNavigate)
      serverNavigate(url.pathname + url.search + url.hash, options);
    else location.assign(url.href);
    return;
  }
  window.dispatchEvent(new Event('tempo:read-before-navigation'));
  history[options.replace ? 'replaceState' : 'pushState'](
    {},
    '',
    url.pathname + url.search + url.hash,
  );
  notify();
  if (options.scroll !== false) window.scrollTo(0, 0);
}
const router = {
  push: (href: string, options?: { scroll?: boolean }) =>
    navigateWorkspace(href, options),
  replace: (href: string, options?: { scroll?: boolean }) =>
    navigateWorkspace(href, { ...options, replace: true }),
  refresh: revalidateVisibleReads,
};
export const useReadRouter = () => router;
export function interceptReadLinks() {
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element)?.closest<HTMLAnchorElement>(
      'a[href]',
    );
    if (!link || link.target || link.download) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      !isWorkspaceRoute(url.pathname) ||
      (url.pathname === location.pathname &&
        url.search === location.search &&
        url.hash)
    )
      return;
    event.preventDefault();
    navigateWorkspace(url.href, {
      scroll: link.dataset.readScroll !== 'false',
    });
  };
  document.addEventListener('click', click, true);
  return () => document.removeEventListener('click', click, true);
}
