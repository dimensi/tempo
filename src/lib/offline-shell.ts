export async function prepareOfflineShell(signal: AbortSignal) {
  if (!('serviceWorker' in navigator))
    throw new Error('Offline shell unavailable');
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let channel: MessageChannel | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel?.port1.close();
      channel?.port2.close();
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
      .then((registration) => {
        if (signal.aborted) return;
        channel = new MessageChannel();
        const close = () => {
          channel?.port1.close();
          channel?.port2.close();
        };
        signal.addEventListener('abort', close, { once: true });
        channel.port1.onmessage = (event) => {
          close();
          signal.removeEventListener('abort', close);
          finish(
            event.data?.contractVersion === 2
              ? undefined
              : new Error('Offline shell update pending'),
          );
        };
        registration?.active?.postMessage({ type: 'OFFLINE_SHELL_VERSION' }, [
          channel.port2,
        ]);
      }, finish);
  });
}
