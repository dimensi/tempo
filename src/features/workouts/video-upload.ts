import { apiFetch } from '@/lib/api-client';
import { workoutMessages as m } from './messages';
export async function sendVideoPart(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> {
  const response = await apiFetch(url, {
    method: 'PUT',
    body: blob,
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? m.forbidden
        : response.status === 409
          ? m.conflict
          : m.videoUploadError,
    );
  signal.throwIfAborted();
  progress(blob.size);
}
