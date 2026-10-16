import { OfflineStorage } from '@/lib/offline-device';
import {
  IndexedWriteStore,
  enqueueWrite,
  pendingWrites,
} from '@/lib/offline-write-queue';
import { expect, it, vi } from 'vitest';
// Controlled IndexedDB boundary. It models commit/abort, not a real browser or eviction policy.
function indexedBoundary() {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  let quota = false;
  const durability = vi.fn();
  const factory = {
    open(name: string) {
      const stores =
        databases.get(name) ?? new Map<string, Map<IDBValidKey, unknown>>();
      const fresh = !databases.has(name);
      databases.set(name, stores);
      const database = {
        objectStoreNames: { contains: (store: string) => stores.has(store) },
        createObjectStore(store: string) {
          stores.set(store, new Map());
        },
        close() {},
        transaction(_names: unknown, _mode: unknown, options: unknown) {
          durability(options);
          const draft = structuredClone(stores);
          let aborted = false;
          const tx = {
            oncomplete: null as (() => void) | null,
            onabort: null as (() => void) | null,
            error: null as DOMException | null,
            abort() {
              if (aborted) return;
              aborted = true;
              queueMicrotask(() => tx.onabort?.());
            },
            objectStore(store: string) {
              const data = draft.get(store)!;
              return {
                get(key: IDBValidKey) {
                  const request = {
                    result: structuredClone(data.get(key)),
                    onsuccess: null as (() => void) | null,
                  };
                  queueMicrotask(() => request.onsuccess?.());
                  return request;
                },
                put(value: unknown, key: IDBValidKey) {
                  data.set(key, structuredClone(value));
                },
                clear() {
                  data.clear();
                },
              };
            },
          };
          setTimeout(() => {
            if (aborted) return;
            if (quota && _mode === 'readwrite') {
              tx.error = new DOMException('full', 'QuotaExceededError');
              tx.abort();
              return;
            }
            if (_mode === 'readwrite') {
              stores.clear();
              for (const [key, value] of draft) stores.set(key, value);
            }
            tx.oncomplete?.();
          }, 0);
          return tx;
        },
      };
      const request = {
        result: database,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      };
      queueMicrotask(() => {
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    durability,
    setQuota: (value: boolean) => {
      quota = value;
    },
  };
}
const partition = 'a'.repeat(43);
const payload = {
  kind: 'measurement' as const,
  data: {
    measuredAt: '2026-09-01',
    note: null,
    values: [{ metric: 'weight' as const, value: '75', unit: 'kg' as const }],
  },
};
it('resolves a local save only after strict commit and restores it through a new store instance', async () => {
  const boundary = indexedBoundary(),
    store = new IndexedWriteStore(boundary.factory);
  await store.update((state) => {
    state.partition = partition;
  });
  let confirmed = false;
  const save = store
    .update((state) => enqueueWrite(state, partition, payload))
    .then(() => {
      confirmed = true;
    });
  await Promise.resolve();
  await Promise.resolve();
  expect(confirmed).toBe(false);
  await save;
  expect(confirmed).toBe(true);
  expect(boundary.durability).toHaveBeenLastCalledWith({
    durability: 'strict',
  });
  const reopened = new IndexedWriteStore(boundary.factory);
  const state = await reopened.update((state) => structuredClone(state));
  expect(state.records).toHaveLength(1);
  expect(pendingWrites(state)).toHaveLength(1);
});
it('rejects quota failure without publishing the edited result or its queue operation', async () => {
  const boundary = indexedBoundary(),
    store = new IndexedWriteStore(boundary.factory);
  await store.update((state) => {
    state.partition = partition;
  });
  boundary.setQuota(true);
  await expect(
    store.update((state) => enqueueWrite(state, partition, payload)),
  ).rejects.toMatchObject({ name: 'QuotaExceededError' });
  boundary.setQuota(false);
  const state = await store.update((state) => structuredClone(state));
  expect(state.records).toEqual([]);
  expect(state.operations).toEqual([]);
});
it('read-cache purge uses another database and cannot erase old pending edits', async () => {
  const boundary = indexedBoundary(),
    store = new IndexedWriteStore(boundary.factory);
  await store.update((state) => {
    state.partition = partition;
    enqueueWrite(state, partition, payload);
  });
  vi.stubGlobal('indexedDB', boundary.factory);
  const cache = new OfflineStorage();
  await cache.purge();
  await cache.close();
  const state = await new IndexedWriteStore(boundary.factory).update((state) =>
    structuredClone(state),
  );
  expect(state.records[0]!.payload).toEqual(payload);
  expect(pendingWrites(state)).toHaveLength(1);
});

it('keeps committed local data readable while write quota is exhausted', async () => {
  const boundary = indexedBoundary(),
    store = new IndexedWriteStore(boundary.factory);
  await store.update((state) => {
    state.partition = partition;
    enqueueWrite(state, partition, payload);
  });
  boundary.setQuota(true);
  const state = await store.read();
  expect(state.records[0]!.payload).toEqual(payload);
  expect(pendingWrites(state)).toHaveLength(1);
});
