/// <reference lib='webworker' />
import { Serwist, type PrecacheEntry } from 'serwist';
import { OfflineStorage } from '@/lib/offline-device';
declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: PrecacheEntry[];
};
const worker = self;
const precache = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cacheName: 'yazio-offline-app-v1',
    fetchOptions: { credentials: 'omit', cache: 'reload' },
    directoryIndex: null,
    cleanURLs: false,
    ignoreURLParametersMatching: [],
  },
});
const allowed = new Set(
  precache.getPrecachedUrls().map((url) => new URL(url).pathname),
);
const navigationPaths = new Set([
  '/',
  '/diary',
  '/analytics',
  '/measurements',
  '/workouts',
  '/settings',
  '/reports',
  '/offline/index.html',
]);
async function purge(previousEpoch?: string) {
  const storage = new OfflineStorage();
  try {
    await storage.purge(Date.now(), previousEpoch);
  } catch {
    /* All clients still block reads. */
  } finally {
    await storage.close().catch(() => {});
  }
  for (const client of await worker.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  }))
    client.postMessage({ type: 'OFFLINE_BLOCKED' });
}
worker.addEventListener('install', (event) => {
  event.waitUntil(
    precache.handleInstall(event).then(() => worker.skipWaiting()),
  );
});
worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await precache.handleActivate(event);
      for (const key of await caches.keys())
        if (
          key.startsWith('yazio-offline-shell-') ||
          key.startsWith('yazio-offline-reader-')
        )
          await caches.delete(key);
      await worker.clients.claim();
    })(),
  );
});
worker.addEventListener('message', (event) => {
  if (event.data?.type === 'OFFLINE_PURGE')
    event.waitUntil(purge(event.data.previousEpoch));
});
worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.status === 401 || response.status === 403)
          event.waitUntil(purge());
        return response;
      }),
    );
    return;
  }
  if (request.method !== 'GET') return;
  if (!url.search && allowed.has(url.pathname)) {
    precache.handleFetch(event);
    return;
  }
  if (
    request.mode === 'navigate' &&
    (navigationPaths.has(url.pathname) ||
      /^\/workouts\/(?:plans\/[A-Za-z0-9_%~-]+\/(?:workouts\/[A-Za-z0-9_%~-]+(?:\/results)?|edit)|sessions\/[A-Za-z0-9_%~-]+(?:\/edit)?|native\/[1-9][0-9]*|links\/[A-Za-z0-9_%~-]+|new)$/.test(
        url.pathname,
      ))
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.status === 401 ||
            response.status === 403 ||
            (response.redirected && new URL(response.url).pathname === '/login')
          )
            event.waitUntil(purge());
          return response;
        })
        .catch(async () => {
          const shell = await precache.matchPrecache('/offline/index.html');
          if (!shell) throw new Error('Offline shell unavailable');
          return shell;
        }),
    );
  }
});
