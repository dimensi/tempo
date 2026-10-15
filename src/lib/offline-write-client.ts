import {
  writeCatalogSchema,
  writeRecordSchema,
  type OfflineWrite,
  type WritePayload,
} from '@/contracts/offline-write';
import { offlineIdentitySchema } from '@/contracts/offline';
import {
  OfflineStorage,
  revealOfflineContent,
  withOfflineCacheLock,
} from '@/lib/offline-device';
import { offlineLocalWindow } from '@/contracts/offline-retention';
import {
  IndexedWriteStore,
  drainWrites,
  enqueueWrite,
  mergeWriteCatalog,
  pruneSettledWrites,
  resolveWrite,
  emptyWriteState,
  pendingWrites,
  type WriteState,
} from './offline-write-queue';
export const writeStore = new IndexedWriteStore();
const lockName = 'yazio-offline-write-queue';
export async function withWriteLock<T>(action: () => Promise<T>) {
  if (!navigator.locks) throw new Error('Storage unavailable');
  return navigator.locks.request(lockName, action);
}
async function eligible() {
  const storage = new OfflineStorage();
  try {
    return (await storage.currentFence()).partition;
  } finally {
    await storage.close();
  }
}
export async function readDeviceWrites(): Promise<WriteState> {
  let value = emptyWriteState();
  await withOfflineCacheLock(async () => {
    const partition = await eligible();
    if (navigator.onLine) {
      const response = await fetch('/api/offline/identity', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (
        !response.ok ||
        offlineIdentitySchema.parse(await response.json()).partition !==
          partition
      )
        return;
    }
    const stored = await writeStore.read();
    if (stored.partition === partition) {
      value = stored;
      const from = offlineLocalWindow(
        Date.now(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ).from;
      pruneSettledWrites(value, from);
      // A read must remain usable when write quota is exhausted, keeping the entered form visible.
      await writeStore
        .update((state) => {
          if (state.partition === partition) pruneSettledWrites(state, from);
        })
        .catch(() => {});
    }
    if ((await eligible()) !== partition) value = emptyWriteState();
  });
  return value;
}
export async function saveDeviceWrite(
  payload: WritePayload,
  recordId?: string,
  expectedBase?: string,
) {
  let saved: OfflineWrite | undefined;
  const result = await withOfflineCacheLock(async () => {
    const partition = await eligible();
    const ready = (await writeStore.read()).partition === partition;
    if (!ready && navigator.onLine) {
      const response = await fetch('/api/offline/writes', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Storage unavailable');
      const catalog = writeCatalogSchema.parse(await response.json());
      if (catalog.partition !== partition) throw new Error('Account changed');
      await writeStore.update((state) => mergeWriteCatalog(state, catalog));
    }
    saved = await writeStore.update((state) =>
      enqueueWrite(
        state,
        partition,
        payload,
        recordId,
        undefined,
        expectedBase,
      ),
    );
  });
  if (result !== 'completed' || !saved) throw new Error('Storage unavailable');
  window.dispatchEvent(new Event('offline-writes-changed'));
  return saved;
}
export async function syncDeviceWrites() {
  if (!navigator.onLine) return;
  await withOfflineCacheLock(async () =>
    withWriteLock(async () => {
      const partition = await eligible();
      const response = await fetch('/api/offline/writes', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return;
      const catalog = writeCatalogSchema.parse(await response.json());
      if (catalog.partition !== partition) return;
      await writeStore.update((state) => {
        mergeWriteCatalog(state, catalog);
        pruneSettledWrites(
          state,
          offlineLocalWindow(
            Date.now(),
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          ).from,
        );
      });
      await drainWrites(
        writeStore,
        partition,
        async (operation) => {
          window.dispatchEvent(new Event('offline-writes-changed'));
          // Recheck the durable auth/device gate before every network write.
          if ((await eligible()) !== partition) return { status: 403 };
          const result = await fetch('/api/offline/writes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operation),
            signal: AbortSignal.timeout(15000),
          });
          return {
            status: result.status,
            ...(result.ok
              ? { record: writeRecordSchema.parse(await result.json()) }
              : {}),
          };
        },
        Date.now,
        10,
      );
    }),
  );
  window.dispatchEvent(new Event('offline-writes-changed'));
}
export async function resolveDeviceWrite(recordId: string, keepLocal: boolean) {
  await withOfflineCacheLock(async () =>
    withWriteLock(async () => {
      const partition = await eligible();
      await writeStore.update((state) => {
        if (state.partition !== partition) throw new Error('Account changed');
        resolveWrite(state, partition, recordId, keepLocal);
      });
    }),
  );
  window.dispatchEvent(new Event('offline-writes-changed'));
}
export async function hasPendingDeviceWrites() {
  return pendingWrites(await writeStore.read()).length > 0;
}
export async function deleteDeviceWrites() {
  await writeStore.update((state) => Object.assign(state, emptyWriteState()));
}

export async function revealDeviceWrites(partition: string) {
  await withOfflineCacheLock(async () => {
    const storage = new OfflineStorage();
    try {
      const fence = await storage.currentFence();
      if (fence.partition === partition)
        revealOfflineContent(fence, '[data-offline-write-private]');
    } finally {
      await storage.close();
    }
  });
}
