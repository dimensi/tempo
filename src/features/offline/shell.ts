export async function prepareOfflineShell() {
  if (!('serviceWorker' in navigator))
    throw new Error('Offline shell unavailable');
  await navigator.serviceWorker.register('/offline-sw.js', { scope: '/' });
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Offline shell unavailable')), 10000),
    ),
  ]);
}
