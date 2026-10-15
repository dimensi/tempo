/** Bound header wait even when the platform's transport does not settle on abort. */
export async function fetchWithDeadline(
  request: RequestInfo | URL,
  init: RequestInit,
  milliseconds: number,
  fetcher: typeof fetch = fetch,
) {
  const signal =
    init.signal ?? (request instanceof Request ? request.signal : undefined);
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    abort = () =>
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    timer = setTimeout(() => {
      const error = new DOMException(
        'Request deadline exceeded',
        'TimeoutError',
      );
      reject(error);
      controller.abort(error);
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([
      fetcher(request, {
        ...init,
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
