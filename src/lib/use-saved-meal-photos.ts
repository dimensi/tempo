'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SafeMealPhotoView } from '@/contracts/nutrition';
import { getOfflineController } from './offline-controller';
import { savedMealPhotoId } from './saved-meal-photo';
import { useReadOnline } from './use-read-online';
export function useSavedMealPhotos(photos: SafeMealPhotoView[]) {
  const online = useReadOnline();
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const [copy, setCopy] = useState<{
    bundle: typeof state.bundle;
    urls: Map<string, string>;
  } | null>(null);
  useEffect(() => {
    if (online || !state.bundle) return;
    const urls = new Map(
      state.photos.map((photo) => [photo.id, URL.createObjectURL(photo.bytes)]),
    );
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setCopy({ bundle: state.bundle, urls });
    });
    return () => {
      active = false;
      setCopy(null);
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [online, state.bundle, state.photos]);
  return {
    online,
    photos: photos.map((photo) => {
      const id = savedMealPhotoId(
        photo,
        state.bundle?.snapshot.photos.items ?? [],
      );
      return {
        ...photo,
        href:
          !online && copy?.bundle === state.bundle && id
            ? (copy.urls.get(id) ?? null)
            : null,
      };
    }),
  };
}
