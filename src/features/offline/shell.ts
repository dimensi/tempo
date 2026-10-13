export async function prepareOfflineShell(signal: AbortSignal) {
  if (!('serviceWorker' in navigator))
    throw new Error('Offline shell unavailable');
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(
        signal.reason ??
          new DOMException('Offline shell preparation aborted', 'AbortError'),
      );
    const timer = setTimeout(
      () => finish(new Error('Offline shell unavailable')),
      10000,
    );
    signal.addEventListener('abort', abort, { once: true });
    // Registration/precache remains public; cancellation releases the private cache lock.
    Promise.resolve()
      .then(() =>
        navigator.serviceWorker.register('/offline-sw.js', { scope: '/' }),
      )
      .then(() => (signal.aborted ? undefined : navigator.serviceWorker.ready))
      .then(() => finish(), finish);
  });
}
