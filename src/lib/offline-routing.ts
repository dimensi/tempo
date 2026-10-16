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
let releasedOfflineRouteId: string | null = null;
let releasedLegacyOfflineRoute: string | null = null;
const releasedOfflineRouteStorageKey = 'tempo:released-offline-route';
export const liveResumeParam = '__tempoLive';
function storedReleasedRoute() {
  try {
    return typeof sessionStorage === 'undefined'
      ? null
      : sessionStorage.getItem(releasedOfflineRouteStorageKey);
  } catch {
    return null;
  }
}
function storeReleasedRoute(value: string) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(releasedOfflineRouteStorageKey, value);
  } catch {}
}
interface SavedReadIdentity {
  partition: string;
  connectionGeneration: string;
  role: 'OWNER' | 'TRAINER';
}
function changed() {
  version++;
  for (const listener of listeners) listener();
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function'
  )
    window.dispatchEvent(new Event('tempo:offline-location-change'));
}
export function isOfflineRoute(url: URL | null) {
  if (url === null) return false;
  const route = new URL(url);
  route.searchParams.delete(liveResumeParam);
  const key = route.pathname + route.search;
  if (history.state?.tempoOfflineRoute !== key) return false;
  const id = history.state?.tempoOfflineRouteId;
  const released = storedReleasedRoute();
  const matchesReleased =
    `route:${key}` === released ||
    (typeof id === 'string'
      ? id === releasedOfflineRouteId || `id:${id}` === released
      : key === releasedLegacyOfflineRoute);
  return !matchesReleased || !navigator.onLine || !networkReachable();
}
export function releaseOfflineRoute(url: URL) {
  const route = new URL(url);
  const resumable = route.searchParams.has(liveResumeParam);
  if (!isOfflineRoute(url) && !resumable) return false;
  route.searchParams.delete(liveResumeParam);
  const state =
    history.state && typeof history.state === 'object' ? history.state : {};
  const id = state.tempoOfflineRouteId;
  if (typeof id === 'string') {
    releasedOfflineRouteId = id;
  } else {
    releasedLegacyOfflineRoute = route.pathname + route.search;
  }
  storeReleasedRoute(`route:${route.pathname + route.search}`);
  delete state.tempoOfflineRoute;
  delete state.tempoOfflineRouteId;
  history.replaceState(state, '', route.pathname + route.search + route.hash);
  changed();
  return true;
}
export function offlineNavigate(href: string, replace = false, scroll = true) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return;
  releasedLegacyOfflineRoute = null;
  history[replace ? 'replaceState' : 'pushState'](
    {
      tempoOfflineRoute: url.pathname + url.search,
      tempoOfflineRouteId: crypto.randomUUID(),
    },
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
      window.addEventListener('tempo:offline-location-change', listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('popstate', listener);
        window.removeEventListener('tempo:offline-location-change', listener);
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
  const continueNavigation = (available: boolean) => {
    if (attempt.signal.aborted || !valid()) return;
    if (!navigator.onLine || !networkReachable()) {
      local();
      return;
    }
    // Unsaved destinations use the ordinary server-authorized navigation at
    // once. Only an already displayed private copy needs the identity fence.
    if (!available) {
      resumeLive();
      return;
    }
    local();
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
      },
      () => {
        if (attempt.signal.aborted || !valid()) return;
        reportNetworkResult(false);
      },
    );
  };
  const saved = hasSaved(url);
  if (typeof saved === 'boolean') continueNavigation(saved);
  else void saved.then(continueNavigation, () => continueNavigation(false));
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
    const saved = hasSaved(url);
    // Let a regular Next link own an online, unsaved transition so its native
    // pending state and latest-navigation ordering remain intact.
    if (saved === false && navigator.onLine && networkReachable()) {
      pendingNavigation?.abort();
      return;
    }
    event.preventDefault();
    navigateReadRoute({
      url,
      hasSaved: () => saved,
      showSaved: () => {
        offlineNavigate(url.href);
        window.dispatchEvent(new Event('tempo:offline-navigation'));
      },
      expectedIdentity: expectedIdentity?.(),
      resumeLive: () => {
        if (resumeVerified && link.dataset?.tempoReadLink === 'true') {
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
