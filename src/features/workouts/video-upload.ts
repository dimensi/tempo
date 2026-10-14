import { workoutMessages as m } from './messages';
export function sendVideoPart(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = (error?: Error) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    xhr.open('PUT', url);
    xhr.timeout = 90_000;
    xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onload = () =>
      done(
        xhr.status >= 200 && xhr.status < 300
          ? undefined
          : new Error(
              xhr.status === 401 || xhr.status === 403
                ? m.noAccess
                : xhr.status === 409
                  ? m.conflict
                  : m.videoUploadError,
            ),
      );
    xhr.onerror = xhr.ontimeout = () => done(new Error(m.videoUploadError));
    xhr.onabort = () => done(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort);
    if (signal.aborted) {
      done(new DOMException('Aborted', 'AbortError'));
      return;
    }
    xhr.send(blob);
  });
}
