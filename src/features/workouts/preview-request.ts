// Only temporary failure metadata and in-flight work are shared. Successful
// private image bytes belong to mounted views and are never retained here.
export type PreviewResult =
  | { state: 'available'; blob: Blob }
  | { state: 'unavailable' }
  | { state: 'denied' };
const RETRY_MS = 60_000;
const failures = new Map<string, number>();
const pending = new Map<string, Promise<PreviewResult>>();
let privacyEpoch = 0;
export function clearPreviewRequests(ownerId: string) {
  privacyEpoch++;
  const prefix = JSON.stringify([ownerId]).slice(0, -1) + ',';
  for (const key of failures.keys())
    if (key.startsWith(prefix)) failures.delete(key);
  for (const key of pending.keys())
    if (key.startsWith(prefix)) pending.delete(key);
}
export function requestPreview(
  ownerId: string,
  exerciseId: number,
  revision: string,
  requestFetch: typeof fetch = fetch,
): Promise<PreviewResult> {
  const key = JSON.stringify([ownerId, exerciseId, revision]);
  const current = pending.get(key);
  if (current) return current;
  if ((failures.get(key) ?? 0) > Date.now())
    return Promise.resolve({ state: 'unavailable' });
  const epoch = privacyEpoch;
  const task = Promise.resolve().then(async (): Promise<PreviewResult> => {
    try {
      const response = await requestFetch(
        `/api/workouts/transformmate/exercises/${exerciseId}/preview?ownerId=${encodeURIComponent(ownerId)}`,
        { cache: 'no-store', credentials: 'same-origin', redirect: 'error' },
      );
      if ([401, 403, 409].includes(response.status)) {
        clearPreviewRequests(ownerId);
        return { state: 'denied' };
      }
      if (privacyEpoch !== epoch) return { state: 'denied' };
      if (!response.ok) throw new Error('Preview unavailable');
      const blob = await response.blob();
      if (privacyEpoch !== epoch) return { state: 'denied' };
      return { state: 'available', blob };
    } catch {
      if (privacyEpoch !== epoch) return { state: 'denied' };
      failures.set(key, Date.now() + RETRY_MS);
      while (failures.size > 256)
        failures.delete(failures.keys().next().value!);
      return { state: 'unavailable' };
    } finally {
      if (pending.get(key) === task) pending.delete(key);
    }
  });
  pending.set(key, task);
  return task;
}
