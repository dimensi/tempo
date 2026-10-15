'use client';
import { useEffect } from 'react';
import {
  observeOfflineDenials,
  purgeOfflineDevice,
} from '@/lib/offline-device';
import { getOfflineController } from './controller';
import { attachOfflineRefresh } from './refresh';
import { syncDeviceWrites } from '@/lib/offline-write-client';
export function OfflineLifecycle({ role }: { role: string }) {
  useEffect(() => {
    const controller = getOfflineController();
    const stopListening = controller.listen();
    const stopObserving = observeOfflineDenials();
    const detach =
      role === 'OWNER' ? attachOfflineRefresh(controller) : () => {};
    if (role !== 'OWNER') void purgeOfflineDevice().catch(() => {});
    let running = false;
    const sync = () => {
      if (
        role !== 'OWNER' ||
        running ||
        !navigator.onLine ||
        document.visibilityState === 'hidden'
      )
        return;
      running = true;
      void controller
        .activate(navigator.onLine)
        .then(() => syncDeviceWrites())
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    const timer = setInterval(sync, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      stopListening();
      stopObserving();
      detach();
    };
  }, [role]);
  return null;
}
