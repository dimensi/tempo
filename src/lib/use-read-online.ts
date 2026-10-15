'use client';
import { useSyncExternalStore } from 'react';
import { networkStatusEvent, networkReachable } from './network-state';
export function useReadOnline() {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(networkStatusEvent, listener);
      window.addEventListener('offline', listener);
      window.addEventListener('online', listener);
      return () => {
        window.removeEventListener(networkStatusEvent, listener);
        window.removeEventListener('offline', listener);
        window.removeEventListener('online', listener);
      };
    },
    () => navigator.onLine && networkReachable(),
    () => true,
  );
}
