'use client';
import { useEffect } from 'react';
import {
  observeOfflineDenials,
  purgeOfflineDevice,
} from '@/lib/offline-device';
import { getOfflineController } from './controller';
import { attachOfflineRefresh } from './refresh';
export function OfflineLifecycle({ role }: { role: string }) {
  useEffect(() => {
    const controller = getOfflineController();
    const stopListening = controller.listen();
    const stopObserving = observeOfflineDenials();
    const detach =
      role === 'OWNER' ? attachOfflineRefresh(controller) : () => {};
    if (role !== 'OWNER') void purgeOfflineDevice().catch(() => {});
    return () => {
      stopListening();
      stopObserving();
      detach();
    };
  }, [role]);
  return null;
}
