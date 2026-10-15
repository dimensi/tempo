'use client';
import { useSyncExternalStore } from 'react';
import { readRevalidateEvent } from './client-read';
let revision = 0;
const listeners = new Set<() => void>();
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
export function useReadRefresh() {
  return useSyncExternalStore(
    (listener) => {
      if (!listeners.size) {
        window.addEventListener(readRevalidateEvent, changed);
        window.addEventListener('offline', changed);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener(readRevalidateEvent, changed);
          window.removeEventListener('offline', changed);
        }
      };
    },
    () => revision,
    () => 0,
  );
}
