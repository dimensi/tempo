import { OfflineStorage } from '@/lib/offline-device';
declare const __OFFLINE_ASSETS__: string[];
declare const __OFFLINE_CACHE_NAME__: string;
declare const __OFFLINE_SHELL__: string;
interface WorkerEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends WorkerEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface MessageEvent extends WorkerEvent {
  data: { type?: string; previousEpoch?: string };
}
const worker = globalThis as unknown as {
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: WorkerEvent) => void,
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void;
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    matchAll(options: {
      includeUncontrolled: boolean;
      type: string;
    }): Promise<Array<{ postMessage(message: unknown): void }>>;
  };
};
const allowed = new Set(__OFFLINE_ASSETS__);
const navigationPaths = new Set([
  '/',
  '/diary',
  '/analytics',
  '/measurements',
  '/workouts',
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
    (async () => {
      const cache = await caches.open(__OFFLINE_CACHE_NAME__);
      await cache.addAll(
        __OFFLINE_ASSETS__.map(
          (url) => new Request(url, { cache: 'reload', credentials: 'omit' }),
        ),
      );
      await worker.skipWaiting();
    })(),
  );
});
worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (
          key.startsWith('yazio-offline-shell-') &&
          key !== __OFFLINE_CACHE_NAME__
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
    event.respondWith(
      caches
        .open(__OFFLINE_CACHE_NAME__)
        .then(
          async (cache) => (await cache.match(url.pathname)) ?? fetch(request),
        ),
    );
    return;
  }
  if (request.mode === 'navigate' && navigationPaths.has(url.pathname)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(__OFFLINE_CACHE_NAME__);
        const shell = await cache.match(__OFFLINE_SHELL__);
        if (!shell) throw new Error('Offline shell unavailable');
        return shell;
      }),
    );
  }
});
