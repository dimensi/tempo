'use client';
import type { TransformMateCatalogItem } from '@/contracts/transformmate';
import { subscribeSessionReset } from '@/lib/offline-device';
import { useEffect, useState } from 'react';
import { clearPreviewRequests, requestPreview } from './preview-request';

export function useExercisePreview(
  ownerId: string,
  item: TransformMateCatalogItem | null,
) {
  const revision = item?.preview.revision;
  const id = item?.id;
  const enabled =
    item &&
    item.preview.coverage !== 'absent' &&
    item.detailCoverage === 'available';
  const key = JSON.stringify([ownerId, id, revision]);
  const [result, setResult] = useState<{
    key: string;
    src?: string;
    denied?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !id || !revision) return;
    let active = true;
    let url: string | undefined;
    const unsubscribe = subscribeSessionReset(() => {
      active = false;
      clearPreviewRequests(ownerId);
      if (url) URL.revokeObjectURL(url);
      url = undefined;
      setResult({ key, denied: true });
    });
    void requestPreview(ownerId, id, revision).then((response) => {
      if (!active) return;
      if (response.state === 'available')
        url = URL.createObjectURL(response.blob);
      setResult({ key, src: url, denied: response.state === 'denied' });
    });
    return () => {
      active = false;
      unsubscribe();
      if (url) URL.revokeObjectURL(url);
    };
  }, [ownerId, id, revision, enabled, key]);
  return result?.key === key ? result : null;
}
