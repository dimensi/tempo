'use client';
import { networkReachable, reportNetworkResult } from '@/lib/network-state';
import { purgeOfflineDevice } from '@/lib/offline-device';
import { offlineIdentitySchema } from '@/contracts/offline';
import { fetchWithDeadline } from './fetch-with-deadline';
import { isOfflineNavigationPath } from './offline-navigation-paths';
import { useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
let version = 0;
let pendingNavigation: AbortController | undefined;
interface SavedReadIdentity {
  partition: string;
  connectionGeneration: string;
  role: 'OWNER' | 'TRAINER';
}
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
export function offlineNavigate(href: string, replace = false, scroll = true) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return;
  history[replace ? 'replaceState' : 'pushState'](
    { tempoOfflineRoute: url.pathname + url.search },
    '',
    url.pathname + url.search + url.hash,
  );
  changed();
  if (scroll) window.scrollTo(0, 0);
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

export function navigateReadRoute({
  url,
  hasSaved,
  showSaved,
  resumeLive,
  expectedIdentity,
  valid = () => true,
}: {
  url: URL;
  hasSaved: (url: URL) => boolean | Promise<boolean>;
  showSaved: () => void;
  resumeLive: () => void;
  expectedIdentity?: SavedReadIdentity | null;
  valid?: () => boolean;
}) {
  pendingNavigation?.abort();
  const attempt = new AbortController();
  pendingNavigation = attempt;
  let savedShown = false;
  const local = () => {
    if (savedShown) return;
    savedShown = true;
    showSaved();
  };
  const saved = hasSaved(url);
  if (typeof saved === 'boolean') {
    if (saved) local();
  } else
    void saved.then((available) => {
      if (available && !attempt.signal.aborted && valid()) local();
    });
  if (!navigator.onLine || !networkReachable()) {
    local();
    return;
  }
  // A saved destination is already interactive while this bounded check and
  // the ordinary Next navigation proceed in the background.
  void fetchWithDeadline(
    '/api/offline/identity',
    {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: attempt.signal,
    },
    2000,
  ).then(
    async (response) => {
      if (attempt.signal.aborted || !valid()) return;
      if (response.ok) {
        if (expectedIdentity) {
          const result = offlineIdentitySchema.safeParse(
            await response.json().catch(() => null),
          );
          if (!result.success) return;
          const identity = result.data;
          if (
            identity.partition !== expectedIdentity.partition ||
            identity.connectionGeneration !==
              expectedIdentity.connectionGeneration ||
            identity.role !== expectedIdentity.role
          ) {
            void purgeOfflineDevice().catch(() => {});
            return;
          }
        }
        if (attempt.signal.aborted || !valid()) return;
        reportNetworkResult(true);
        resumeLive();
        return;
      }
      if (response.status === 409) {
        // A changed connection generation invalidates the displayed fence.
        // purgeOfflineDevice conceals synchronously before physical cleanup.
        void purgeOfflineDevice().catch(() => {});
        return;
      }
      if (response.status === 401 || response.status === 403) return;
      if (!savedShown) resumeLive();
    },
    () => {
      if (attempt.signal.aborted || !valid()) return;
      reportNetworkResult(false);
      local();
    },
  );
}

export function interceptOfflineLinks(
  hasSaved: (url: URL) => boolean | Promise<boolean> = () => false,
  resumeVerified?: (url: URL) => void,
  expectedIdentity?: () => SavedReadIdentity | null,
) {
  let resuming: HTMLAnchorElement | undefined;
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
    if (!link || link === resuming || link.target || link.download) return;
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
    navigateReadRoute({
      url,
      hasSaved,
      showSaved: () => {
        offlineNavigate(url.href);
        window.dispatchEvent(new Event('tempo:offline-navigation'));
      },
      expectedIdentity: expectedIdentity?.(),
      resumeLive: () => {
        if (resumeVerified) {
          resumeVerified(url);
          return;
        }
        // Resume the original link so Next keeps its scroll options, pending
        // state and keyboard-selection ordering. Bypass only this one replay.
        resuming = link;
        try {
          link.click();
        } finally {
          resuming = undefined;
        }
      },
      valid: () => link.isConnected !== false,
    });
  };
  const cancel = () => pendingNavigation?.abort();
  document.addEventListener('click', click, true);
  window.addEventListener('popstate', cancel);
  return () => {
    pendingNavigation?.abort();
    document.removeEventListener('click', click, true);
    window.removeEventListener('popstate', cancel);
  };
}
