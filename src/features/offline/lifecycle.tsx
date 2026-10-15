'use client';
import {
  observeReadResources,
  revalidateVisibleReads,
  prepareMedicalReads,
} from '@/lib/client-read';
import { useEffect } from 'react';
import {
  observeOfflineDenials,
  purgeOfflineDevice,
} from '@/lib/offline-device';
import { getOfflineController } from '@/lib/offline-controller';
import { attachOfflineRefresh } from './refresh';
import {
  hasPendingDeviceWrites,
  syncDeviceWrites,
} from '@/lib/offline-write-client';
export function OfflineLifecycle({ role }: { role: string }) {
  useEffect(() => {
    const controller = getOfflineController();
    const stopListening = controller.listen();
    const stopObserving = observeOfflineDenials();
    const stopReads = observeReadResources();
    const detach = ['OWNER', 'TRAINER'].includes(role)
      ? attachOfflineRefresh(controller)
      : () => {};
    if (!['OWNER', 'TRAINER'].includes(role))
      void purgeOfflineDevice().catch(() => {});
    let running = false;
    const sync = () => {
      if (
        !['OWNER', 'TRAINER'].includes(role) ||
        running ||
        !navigator.onLine ||
        document.visibilityState === 'hidden'
      )
        return;
      running = true;
      void controller
        .activate(navigator.onLine)
        .then(async () => {
          if (controller.getSnapshot().status !== 'ready') return;
          if (controller.getSnapshot().bundle?.snapshot.role === 'OWNER')
            await syncDeviceWrites();
          await prepareMedicalReads();
          revalidateVisibleReads();
        })
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    };
    let readyScope = '';
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const stopSummary = controller.subscribe(() => {
      void prepareMedicalReads();
      const state = controller.getSnapshot();
      if (
        state.status !== 'ready' ||
        !state.bundle ||
        state.bundle.snapshot.role !== 'OWNER'
      )
        return;
      const scope = `${state.bundle.fence.partition}:${state.bundle.fence.deviceEpoch}`;
      if (scope === readyScope) return;
      readyScope = scope;
      // The initial activation can be superseded by pageshow/navigation. Initialize
      // the existing write catalog once the resulting read scope is actually ready.
      clearTimeout(readyTimer);
      readyTimer = setTimeout(sync, 0);
    });
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    const timer = setInterval(() => {
      if (role === 'OWNER')
        void hasPendingDeviceWrites()
          .then((pending) => {
            if (pending) sync();
          })
          .catch(() => {});
    }, 15000);
    return () => {
      clearInterval(timer);
      clearTimeout(readyTimer);
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      stopListening();
      stopSummary();
      stopReads();
      stopObserving();
      detach();
    };
  }, [role]);
  return null;
}
