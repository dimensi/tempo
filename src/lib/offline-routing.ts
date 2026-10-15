'use client';
import { networkReachable } from '@/lib/network-state';
import { useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
let version = 0;
function changed() {
  version++;
  for (const listener of listeners) listener();
}
export function isOfflineRoute(url: URL | null) {
  return (
    url !== null &&
    history.state?.tempoOfflineRoute === url.pathname + url.search
  );
}
export function offlineNavigate(href: string, replace = false) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return;
  history[replace ? 'replaceState' : 'pushState'](
    { tempoOfflineRoute: url.pathname + url.search },
    '',
    url.pathname + url.search + url.hash,
  );
  changed();
  window.scrollTo(0, 0);
}
export function useOfflineLocation() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      window.addEventListener('popstate', listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('popstate', listener);
      };
    },
    () => `${version}:${location.pathname}${location.search}`,
    () => '',
  );
  return typeof location === 'undefined' ? null : new URL(location.href);
}
export function interceptOfflineLinks() {
  const click = (event: MouseEvent) => {
    if (
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
      url.pathname.startsWith('/api/') ||
      url.pathname === '/login'
    )
      return;
    // Once transport is available, every ordinary link uses the live router.
    if (navigator.onLine && networkReachable()) return;
    event.preventDefault();
    offlineNavigate(url.href);
  };
  document.addEventListener('click', click, true);
  return () => document.removeEventListener('click', click, true);
}
