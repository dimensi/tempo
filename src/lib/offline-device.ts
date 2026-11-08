import { browserStore } from './browser-storage';
export const offlineDeviceMessages = {
  title: 'Данные на устройстве',
  cleanupWarning: 'Не удалось полностью очистить данные устройства.',
} as const;
export const sessionResetEvent = 'tempo:session-reset';
export function notifySessionReset() {
  window.dispatchEvent(new Event(sessionResetEvent));
}
export function subscribeSessionReset(listener: () => void) {
  window.addEventListener(sessionResetEvent, listener);
  const storage = (event: StorageEvent) => {
    if (event.key === 'tempo:session-reset') listener();
  };
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(sessionResetEvent, listener);
    window.removeEventListener('storage', storage);
  };
}
/** Only write transactions need cross-tab exclusion; read cache has no device gate. */
export async function withOfflineCacheLock(
  operation: () => Promise<void>,
): Promise<'completed' | 'unavailable'> {
  if (!navigator.locks) return 'unavailable';
  await navigator.locks.request(
    'yazio-offline-mutation',
    { mode: 'shared' },
    operation,
  );
  return 'completed';
}
export class OfflineStorage {
  async purge() {
    await browserStore<void>(
      ['metadata', 'bundle', 'photos', 'files', 'resources'],
      'readwrite',
      (tx) => {
        for (const name of [
          'metadata',
          'bundle',
          'photos',
          'files',
          'resources',
        ])
          tx.objectStore(name).clear();
      },
    );
  }
}
