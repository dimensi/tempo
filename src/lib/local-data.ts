import { clientReads } from './client-read';
import { OfflineStorage } from './offline-device';
import { savedFiles } from './saved-files';
import { clearVideoDrafts } from './workout-video-draft';

const localDataReset = 'tempo:local-data-reset';
async function clearLocalMemory() {
  clientReads.clear();
  savedFiles.clear();
  await clearVideoDrafts();
}
export function subscribeLocalDataReset(listener: () => void) {
  window.addEventListener(localDataReset, listener);
  return () => window.removeEventListener(localDataReset, listener);
}
export function observeLocalDataReset() {
  const reset = (event: StorageEvent) => {
    if (event.key !== localDataReset) return;
    void clearLocalMemory().catch(() => {});
    window.dispatchEvent(new Event(localDataReset));
  };
  window.addEventListener('storage', reset);
  return () => window.removeEventListener('storage', reset);
}
/** Explicit device cleanup leaves sessions and the pending-write queue intact. */
export async function clearLocalData() {
  const memory = clearLocalMemory();
  window.dispatchEvent(new Event(localDataReset));
  try {
    await Promise.all([new OfflineStorage().purge(), memory]);
  } finally {
    try {
      localStorage.setItem(localDataReset, crypto.randomUUID());
    } catch {
      /* Local cleanup still works when cross-tab storage is unavailable. */
    }
  }
}
