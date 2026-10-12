'use client';
import { useEffect } from 'react';
import {
  observeOfflineDenials,
  purgeOfflineDevice,
  concealOfflineContent,
} from '@/lib/offline-device';
import { getOfflineController } from './controller';

export function OfflineLifecycle({ role }: { role: string }) {
  useEffect(() => {
    const controller = getOfflineController();
    const stopListening = controller.listen();
    const stopObserving = observeOfflineDenials();
    const refresh = () => {
      if (role !== 'OWNER') {
        void purgeOfflineDevice().catch(() => {});
        return;
      }
      if (controller.getSnapshot().status !== 'saving')
        void controller.activate();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const hide = () => {
      concealOfflineContent();
      controller.invalidate();
    };
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 60000);
    return () => {
      stopListening();
      stopObserving();
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [role]);
  return null;
}
