/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
// Retirement at the original URL updates already installed workers without a reload.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (/^yazio-offline-(?:app|shell|reader)[-:]/.test(name))
          await caches.delete(name);
      await self.clients.claim();
      await self.registration.unregister();
    })(),
  );
});
// No fetch handler: the browser uses the network normally, including API/RSC.
export {};
