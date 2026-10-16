'use client';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { installReadNavigation } from '@/components/shared/read-link';
import { getOfflineController } from '@/lib/offline-controller';
import {
  interceptOfflineLinks,
  isOfflineRoute,
  liveResumeParam,
  navigateReadRoute,
  offlineNavigate,
  releaseOfflineRoute,
} from '@/lib/offline-routing';
import { hasSavedReadRoute } from '@/lib/saved-read-route';
import { hasSavedMedicalRoute } from '@/lib/client-read';
import { networkReachable } from '@/lib/network-state';

const liveResumeStorageKey = 'tempo:verified-live-resume';
const liveAccessStorageKey = 'tempo:verified-live-access';

export function ReadNavigation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingLive = useRef<{
    href: string;
    token: string;
    nextHref?: string;
  } | null>(null);
  const beginLiveResume = useRef<((url: URL) => void) | null>(null);
  useEffect(() => {
    const token = searchParams.get(liveResumeParam);
    if (!token || sessionStorage.getItem(liveResumeStorageKey) !== token)
      return;
    let frame = 0;
    let stableFrames = 0;
    const settle = () => {
      if (sessionStorage.getItem(liveResumeStorageKey) !== token) return;
      const current = new URL(location.href);
      if (
        isOfflineRoute(current) ||
        current.searchParams.get(liveResumeParam) === token
      ) {
        if (releaseOfflineRoute(current) && !pendingLive.current?.nextHref)
          sessionStorage.setItem(liveAccessStorageKey, 'true');
        stableFrames = 0;
      } else {
        stableFrames++;
      }
      if (stableFrames >= 2) {
        const nextHref = pendingLive.current?.nextHref;
        sessionStorage.removeItem(liveResumeStorageKey);
        pendingLive.current = null;
        if (nextHref) {
          beginLiveResume.current?.(new URL(nextHref));
          return;
        }
        sessionStorage.setItem(liveAccessStorageKey, 'true');
        return;
      }
      frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [searchParams]);
  useEffect(() => {
    const controller = getOfflineController();
    const resumeLive = (
      url: URL,
      options: { replace?: boolean; scroll?: boolean } = {},
      force = false,
    ) => {
      if (force || isOfflineRoute(url)) {
        // The saved shell changes history without changing Next's route tree.
        // Force one distinct RSC URL and serialize a click that races recovery.
        if (pendingLive.current) {
          if (pendingLive.current.href !== url.href)
            pendingLive.current.nextHref = url.href;
          return;
        }
        const token = crypto.randomUUID();
        pendingLive.current = { href: url.href, token };
        sessionStorage.setItem(liveResumeStorageKey, token);
        const liveUrl = new URL(url);
        liveUrl.searchParams.set(liveResumeParam, token);
        router.replace(liveUrl.pathname + liveUrl.search + liveUrl.hash, {
          scroll: false,
        });
        return;
      }
      const href = url.pathname + url.search + url.hash;
      if (options.replace) router.replace(href, { scroll: options.scroll });
      else router.push(href, { scroll: options.scroll });
    };
    beginLiveResume.current = (url) =>
      resumeLive(url, { replace: true, scroll: false }, true);
    const savedIdentity = () => {
      const snapshot = controller.getSnapshot().bundle?.snapshot;
      return snapshot
        ? {
            partition: snapshot.partition,
            connectionGeneration: snapshot.connectionGeneration,
            role: snapshot.role,
          }
        : null;
    };
    const hasSaved = (url: URL) => {
      if (
        sessionStorage.getItem(liveAccessStorageKey) === 'true' &&
        navigator.onLine &&
        networkReachable()
      )
        return false;
      const state = controller.getSnapshot();
      const snapshotSaved =
        state.error !== 'denied' &&
        !!state.bundle &&
        hasSavedReadRoute(state.bundle.snapshot, url);
      if (snapshotSaved) return true;
      return url.pathname === '/anamnesis' ||
        url.pathname.startsWith('/anamnesis/')
        ? hasSavedMedicalRoute(url)
        : false;
    };
    const stopNavigation = installReadNavigation((href, options) => {
      const url = new URL(href, location.href);
      navigateReadRoute({
        url,
        hasSaved,
        expectedIdentity: savedIdentity(),
        showSaved: () => {
          offlineNavigate(
            url.href,
            options?.replace,
            options?.scroll !== false,
          );
          window.dispatchEvent(new Event('tempo:offline-navigation'));
        },
        resumeLive: () => resumeLive(url, options),
      });
    });
    const stopLinks = interceptOfflineLinks(
      hasSaved,
      (url) => resumeLive(url),
      savedIdentity,
    );
    const stopReady = controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (state.status === 'ready' && state.bundle) {
        const current = new URL(location.href);
        if (isOfflineRoute(current))
          resumeLive(current, { replace: true, scroll: false });
      }
    });
    return () => {
      stopLinks();
      stopNavigation();
      stopReady();
      beginLiveResume.current = null;
    };
  }, [router]);
  return null;
}
