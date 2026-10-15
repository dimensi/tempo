/// <reference lib='webworker' />
import { Serwist, type PrecacheEntry } from 'serwist';
import { OfflineStorage } from '@/lib/offline-device';
declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: PrecacheEntry[];
};
const worker = self;
const appCacheName = `yazio-offline-app-v2:${JSON.stringify(self.__SW_MANIFEST.map((entry) => [entry.url, entry.revision]).sort())}`;
const precache = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    // Isolate manifests: an installed update cannot overwrite the document used
    // by the active worker. Keep waiting until every old client is closed.
    cacheName: appCacheName,
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
  '/workouts/catalog',
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
  event.waitUntil(precache.handleInstall(event));
});
worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await precache.handleActivate(event);
      for (const key of await caches.keys())
        if (
          key.startsWith('yazio-offline-shell-') ||
          key.startsWith('yazio-offline-reader-') ||
          (key.startsWith('yazio-offline-app-') && key !== appCacheName)
        )
          await caches.delete(key);
      // Do not claim clients rendered by another shell version.
    })(),
  );
});
worker.addEventListener('message', (event) => {
  if (event.data?.type === 'OFFLINE_SHELL_VERSION')
    event.ports[0]?.postMessage({ contractVersion: 2 });
  if (event.data?.type === 'OFFLINE_PURGE')
    event.waitUntil(purge(event.data.previousEpoch));
});
worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  const unavailable = () =>
    worker.clients
      .get(event.clientId)
      .then((client) =>
        client?.postMessage({ type: 'OFFLINE_NETWORK_UNAVAILABLE' }),
      );
  if (url.pathname.startsWith('/api/') || request.headers.get('RSC') === '1') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 401 || response.status === 403)
            event.waitUntil(purge());
          if (response.status >= 500) event.waitUntil(unavailable());
          return response;
        })
        .catch((error) => {
          if (
            !request.signal.aborted &&
            !(error instanceof Error && error.name === 'AbortError')
          )
            event.waitUntil(unavailable());
          throw error;
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
