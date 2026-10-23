import { offlineLocalWindow } from '@/contracts/offline-retention';
import {
  writeCatalogSchema,
  writeRecordSchema,
  type OfflineWrite,
  type WritePayload,
  type WriteRecord,
} from '@/contracts/offline-write';
import { withOfflineCacheLock } from '@/lib/offline-device';
import { apiFetch } from './api-client';
import { revalidateVisibleReads } from './client-read';
import {
  IndexedWriteStore,
  drainWrites,
  emptyWriteState,
  enqueueWrite,
  mergeWriteCatalog,
  pendingWrites,
  pruneSettledWrites,
  resolveWrite,
  type WriteState,
} from './offline-write-queue';
import { readSession, sessionGeneration } from './session-state';
export const writeStore = new IndexedWriteStore();
const lockName = 'yazio-offline-write-queue';
export async function withWriteLock<T>(action: () => Promise<T>) {
  if (!navigator.locks) throw new Error('Storage unavailable');
  return navigator.locks.request(lockName, action);
}
async function eligible() {
  const current = readSession();
  if (!current || current.role !== 'OWNER')
    throw new Error('Account unavailable');
  return current.partition;
}
export async function readDeviceWrites(): Promise<WriteState> {
  let value = emptyWriteState();
  await withOfflineCacheLock(async () => {
    const partition = await eligible();
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
      const response = await apiFetch('/api/offline/writes', {
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
const syncControllers = new Set<AbortController>();
export function cancelDeviceSync() {
  for (const controller of syncControllers) controller.abort();
}
export async function syncDeviceWrites() {
  if (!navigator.onLine) return;
  const controller = new AbortController();
  const generation = sessionGeneration();
  let acknowledged = false;
  syncControllers.add(controller);
  try {
    await withOfflineCacheLock(async () =>
      withWriteLock(async () => {
        const partition = await eligible();
        const response = await apiFetch('/api/offline/writes', {
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!response.ok) return;
        const catalog = writeCatalogSchema.parse(await response.json());
        if (
          catalog.partition !== partition ||
          generation !== sessionGeneration()
        )
          return;
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
            // Recheck the current account before every network write.
            if ((await eligible()) !== partition) return { status: 403 };
            const result = await apiFetch('/api/offline/writes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(operation),
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(15000),
              ]),
            });
            if (result.ok) acknowledged = true;
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
    if (acknowledged && generation === sessionGeneration()) {
      revalidateVisibleReads();
      try {
        localStorage.setItem('tempo:writes-synced', crypto.randomUUID());
      } catch {
        /* Other tabs may refresh later. */
      }
    }
  } finally {
    syncControllers.delete(controller);
  }
}
export async function resolveDeviceWrite(recordId: string, keepLocal: boolean) {
  await withOfflineCacheLock(async () =>
    withWriteLock(async () => {
      const partition = await eligible();
      const stored = await writeStore.read();
      const related = stored.operations.filter(
        (item) =>
          item.operation.recordId === recordId && item.status !== 'synced',
      );
      let serverRecord: WriteRecord | undefined;
      if (
        keepLocal &&
        related.length &&
        related.every(
          (item) => item.reason === 'conflict' || item.status === 'local',
        ) &&
        related.every(
          (item) =>
            item.operation.payload.kind === 'workout' &&
            item.operation.payload.feedback,
        )
      ) {
        const response = await apiFetch('/api/offline/writes', {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('Storage unavailable');
        const catalog = writeCatalogSchema.parse(await response.json());
        if (catalog.partition !== partition || (await eligible()) !== partition)
          throw new Error('Account changed');
        serverRecord = catalog.records.find((item) => item.id === recordId);
      }
      await writeStore.update((state) => {
        if (state.partition !== partition) throw new Error('Account changed');
        resolveWrite(state, partition, recordId, keepLocal, serverRecord);
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

export async function synchronizeDeviceWrite(operation: OfflineWrite) {
  await syncDeviceWrites().catch(() => {});
  const state = await writeStore.read();
  if (state.partition !== operation.partition) return null;
  return (
    state.operations.find(
      (item) => item.operation.id === operation.id && item.status === 'synced',
    )?.result ?? null
  );
}
