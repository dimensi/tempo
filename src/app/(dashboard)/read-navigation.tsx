'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { installReadNavigation } from '@/components/shared/read-link';
import { getOfflineController } from '@/lib/offline-controller';
import {
  interceptOfflineLinks,
  navigateReadRoute,
  offlineNavigate,
} from '@/lib/offline-routing';
import { hasSavedReadRoute } from '@/lib/saved-read-route';
export function ReadNavigation() {
  const router = useRouter();
  useEffect(() => {
    const savedIdentity = () => {
      const snapshot = getOfflineController().getSnapshot().bundle?.snapshot;
      return snapshot
        ? {
            partition: snapshot.partition,
            connectionGeneration: snapshot.connectionGeneration,
            role: snapshot.role,
          }
        : null;
    };
    const hasSaved = (url: URL) => {
      const state = getOfflineController().getSnapshot();
      return (
        state.error !== 'denied' &&
        !!state.bundle &&
        hasSavedReadRoute(state.bundle.snapshot, url)
      );
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
        resumeLive: () =>
          options?.replace
            ? router.replace(href, { scroll: options.scroll })
            : router.push(href, { scroll: options?.scroll }),
      });
    });
    const stopLinks = interceptOfflineLinks(
      hasSaved,
      (url) => router.push(url.pathname + url.search + url.hash),
      savedIdentity,
    );
    return () => {
      stopLinks();
      stopNavigation();
    };
  }, [router]);
  return null;
}
