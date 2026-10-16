import { browserStore } from './browser-storage';
export const offlineDeviceMessages = {
  title: 'Данные на устройстве',
  cleanupWarning: 'Не удалось полностью очистить данные устройства.',
} as const;
export interface CacheFence {
  partition: string;
  generation: number;
  deviceEpoch: string;
}
export interface StoredOfflineFile {
  id: string;
  label: string;
  kind: 'pdf' | 'video';
  bytes: Blob;
  savedAt: number;
  fence: CacheFence;
}
export const offlineFileLimits = {
  bytes: 300 * 1024 * 1024,
  count: 30,
  singleBytes: 256 * 1024 * 1024,
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
  async files(partition: string): Promise<StoredOfflineFile[]> {
    return browserStore(['files'], 'readonly', (tx, done) => {
      const request = tx.objectStore('files').getAll();
      request.onsuccess = () =>
        done(
          (request.result as StoredOfflineFile[]).filter(
            (file) => file.fence.partition === partition,
          ),
        );
    });
  }
  async writeFile(file: StoredOfflineFile | { id: string; fence: CacheFence }) {
    await browserStore<void>(['files'], 'readwrite', (tx) => {
      const store = tx.objectStore('files');
      if (!('bytes' in file)) {
        store.delete(file.id);
        return;
      }
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (request.result as StoredOfflineFile[]).filter(
          (row) => row.id !== file.id,
        );
        if (
          file.bytes.size > offlineFileLimits.singleBytes ||
          rows.length >= offlineFileLimits.count ||
          rows.reduce((sum, row) => sum + row.bytes.size, file.bytes.size) >
            offlineFileLimits.bytes
        ) {
          tx.abort();
          return;
        }
        store.put(file, file.id);
      };
    });
  }
  async close() {
    /* Connections close after each transaction. */
  }
}
