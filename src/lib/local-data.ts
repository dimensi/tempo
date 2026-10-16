import { clientReads } from './client-read';
import { OfflineStorage } from './offline-device';
import { savedFiles } from './saved-files';
import { clearVideoDrafts } from './workout-video-draft';

/** Explicit device cleanup leaves the independent pending-write queue intact. */
export async function clearLocalData() {
  clientReads.clear();
  savedFiles.clear();
  await Promise.all([new OfflineStorage().purge(), clearVideoDrafts()]);
}
