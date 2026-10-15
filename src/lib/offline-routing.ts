'use client';
import { networkReachable, reportNetworkResult } from '@/lib/network-state';
import { fetchWithDeadline } from './fetch-with-deadline';
import { isOfflineNavigationPath } from './offline-navigation-paths';
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
export function interceptOfflineLinks(navigateOnline?: (href: string) => void) {
  let pending: AbortController | undefined;
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
      url.pathname.startsWith('/api/') ||
      url.pathname === '/login' ||
      !isOfflineNavigationPath(url.pathname) ||
      (url.pathname === location.pathname &&
        url.search === location.search &&
        url.hash)
    )
      return;
    event.preventDefault();
    pending?.abort();
    const attempt = new AbortController();
    pending = attempt;
    const local = () => {
      offlineNavigate(url.href);
      window.dispatchEvent(new Event('tempo:offline-navigation'));
    };
    if (!navigator.onLine || !networkReachable()) {
      local();
      return;
    }
    // Check before handing the screen to Next's pending navigation. Some mobile
    // transports keep onLine=true and leave navigation requests pending indefinitely.
    void fetchWithDeadline(
      '/api/offline/identity',
      {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: attempt.signal,
      },
      2000,
    ).then(
      () => {
        if (attempt.signal.aborted) return;
        reportNetworkResult(true);
        if (navigateOnline)
          navigateOnline(url.pathname + url.search + url.hash);
        else location.assign(url.href);
      },
      () => {
        if (attempt.signal.aborted) return;
        reportNetworkResult(false);
        local();
      },
    );
  };
  document.addEventListener('click', click, true);
  return () => {
    pending?.abort();
    document.removeEventListener('click', click, true);
  };
}
