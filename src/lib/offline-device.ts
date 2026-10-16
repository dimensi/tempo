import {
  pruneReadRecords,
  readRecordSchema,
  type ReadRecord,
} from '@/contracts/read-resources';
import { reportNetworkResult } from '@/lib/network-state';
import { clearVideoDrafts } from '@/lib/workout-video-draft';
import {
  offlineLimits,
  offlineSnapshotSchema,
  type OfflineSnapshot,
} from '@/contracts/offline';
import {
  offlineLocalWindow,
  pruneOfflineSnapshot,
} from '@/contracts/offline-retention';
import { ownerConfirmedYazioWeightPolicyVersion } from '@/contracts/yazio-weight-policy';
export const offlineDeviceLimits = {
  photoBytes: 50 * 1024 * 1024,
} as const;
export const offlineDeviceMessages = {
  title: 'Работа без сети',
  cleanupWarning:
    'Offline-чтение заблокировано. Не удалось полностью очистить данные устройства.',
} as const;
export interface CacheFence {
  partition: string;
  generation: number;
  deviceEpoch: string;
}
export interface CacheMetadata {
  weightPolicyVersion: string;
  generation: number;
  partition: string | null;
  connectionGeneration: string | null;
  enabled: boolean;
  lastSeenAt: number;
  deviceEpoch: string | null;
}
export interface CachedBundle<T> {
  schemaVersion: 2;
  weightPolicyVersion: string;
  fence: CacheFence;
  savedAt: number;
  expiresAt: number;
  sessionExpiresAt: number;
  snapshot: T;
  missingPhotos: string[];
  photoBytes: number;
}
export function matchesFence(metadata: CacheMetadata, fence: CacheFence) {
  return (
    metadata.enabled &&
    metadata.partition === fence.partition &&
    metadata.generation === fence.generation &&
    metadata.deviceEpoch === fence.deviceEpoch
  );
}
export function canReadBundle<T>(
  metadata: CacheMetadata,
  bundle: CachedBundle<T>,
  now: number,
) {
  return (
    matchesFence(metadata, bundle.fence) &&
    bundle.schemaVersion === 2 &&
    bundle.weightPolicyVersion === ownerConfirmedYazioWeightPolicyVersion &&
    metadata.weightPolicyVersion === ownerConfirmedYazioWeightPolicyVersion &&
    [now, bundle.savedAt, metadata.lastSeenAt].every(Number.isFinite) &&
    now >= metadata.lastSeenAt &&
    now >= bundle.savedAt &&
    bundle.photoBytes >= 0 &&
    bundle.photoBytes <= offlineDeviceLimits.photoBytes
  );
}
export function nextMetadata(
  metadata: CacheMetadata,
  now: number,
): CacheMetadata {
  return {
    weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
    generation: metadata.generation + 1,
    partition: null,
    connectionGeneration: null,
    enabled: false,
    lastSeenAt: Math.max(metadata.lastSeenAt, now),
    deviceEpoch: null,
  };
}
export function initialMetadata(): CacheMetadata {
  return {
    weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
    generation: 0,
    partition: null,
    connectionGeneration: null,
    enabled: false,
    lastSeenAt: 0,
    deviceEpoch: null,
  };
}

const databaseName = 'yazio-offline-read-v1';
const stores = ['metadata', 'bundle', 'photos', 'files', 'resources'];
const gateKey = 'yazio.offline.block.v1';
const channelName = 'yazio-offline-lifecycle-v1';
const mutationLockName = 'yazio-offline-mutation';
const mutationIntentPrefix = 'yazio.offline.intent:';
export const offlineBlockedEvent = 'yazio:offline-blocked';
interface DeviceGate {
  epoch: string;
  disabled: boolean;
}
let memoryBlocked = false;
let pendingDeviceMutations = 0;
let pageRestorePending = false;
export function hasMutationIntent(storage = browserGateStorage()) {
  if (pendingDeviceMutations) return true;
  if (!storage) throw new OfflineStorageError('unavailable');
  for (let index = 0; index < storage.length; index++)
    if (storage.key(index)?.startsWith(mutationIntentPrefix)) return true;
  return false;
}
function readGate(storage: Storage | undefined): DeviceGate {
  try {
    if (!storage) throw new Error();
    const raw = storage.getItem(gateKey);
    if (!raw) return { epoch: 'initial', disabled: true };
    const gate = JSON.parse(raw);
    if (typeof gate.epoch !== 'string' || typeof gate.disabled !== 'boolean')
      throw new Error();
    return gate;
  } catch {
    throw new OfflineStorageError('unavailable');
  }
}
function writeGate(storage: Storage | undefined, gate: DeviceGate) {
  try {
    if (!storage) throw new Error();
    storage.setItem(gateKey, JSON.stringify(gate));
  } catch {
    throw new OfflineStorageError('unavailable');
  }
}
function browserGateStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
export function notifyOfflineBlocked() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('workout-draft:')) sessionStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
  memoryBlocked = true;
  concealOfflineContent();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(offlineBlockedEvent));
}
export function concealOfflineContent() {
  if (typeof document !== 'undefined')
    for (const node of document.querySelectorAll<HTMLElement>(
      '[data-offline-private], [data-offline-write-private]',
    ))
      node.hidden = true;
}
export function concealOfflineContentForPageHide() {
  pageRestorePending = true;
  concealOfflineContent();
}
export function isOfflinePageRestorePending() {
  return pageRestorePending;
}
export function revealOfflineContent(
  fence: CacheFence,
  selector = '[data-offline-private]',
) {
  try {
    const gate = readGate(browserGateStorage());
    if (
      hasMutationIntent() ||
      memoryBlocked ||
      gate.disabled ||
      gate.epoch !== fence.deviceEpoch
    )
      return;
    for (const node of document.querySelectorAll<HTMLElement>(selector))
      node.hidden = false;
    if (selector === '[data-offline-private]') pageRestorePending = false;
  } catch {
    concealOfflineContent();
  }
}
export function subscribeOfflineBlocked(listener: () => void) {
  const clear = () => {
    try {
      const storage = browserGateStorage();
      if (!readGate(storage).disabled)
        writeGate(storage, { epoch: crypto.randomUUID(), disabled: true });
    } catch {
      /* An inaccessible gate always fails closed on reads. */
    }
    notifyOfflineBlocked();
  };
  const channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(channelName);
  if (channel) channel.onmessage = clear;
  const storage = (event: StorageEvent) => {
    if (event.key?.startsWith(mutationIntentPrefix) && event.newValue !== null)
      clear();
    if (event.key === gateKey) {
      try {
        if (readGate(globalThis.localStorage).disabled) clear();
      } catch {
        clear();
      }
    }
  };
  window.addEventListener(offlineBlockedEvent, listener);
  window.addEventListener('storage', storage);
  const message = (event: MessageEvent) => {
    if (event.data?.type !== 'OFFLINE_BLOCKED') return;
    try {
      const gate = readGate(browserGateStorage());
      // A completed purge from an older document cannot revoke a newer,
      // explicitly verified device scope. Unscoped server denial still blocks.
      if (
        typeof event.data.previousEpoch === 'string' &&
        !gate.disabled &&
        gate.epoch !== event.data.previousEpoch
      )
        return;
    } catch {
      // Inaccessible local state fails closed.
    }
    clear();
  };
  navigator.serviceWorker?.addEventListener('message', message);
  return () => {
    channel?.close();
    window.removeEventListener(offlineBlockedEvent, listener);
    window.removeEventListener('storage', storage);
    navigator.serviceWorker?.removeEventListener('message', message);
  };
}
export async function purgeOfflineDevice() {
  // The durable blocker and synchronous UI notification precede physical cleanup.
  let failed = false;
  memoryBlocked = true;
  let previousEpoch: string | undefined;
  try {
    previousEpoch = readGate(globalThis.localStorage).epoch;
    writeGate(globalThis.localStorage, {
      epoch: crypto.randomUUID(),
      disabled: true,
    });
  } catch {
    failed = true;
  }
  notifyOfflineBlocked();
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type: 'OFFLINE_BLOCKED' });
    channel.close();
  }
  if (typeof navigator !== 'undefined')
    navigator.serviceWorker?.controller?.postMessage({
      type: 'OFFLINE_PURGE',
      previousEpoch,
    });
  const storage = new OfflineStorage();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([
        storage.purge(Date.now(), previousEpoch),
        clearVideoDrafts(),
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new OfflineStorageError('unavailable')),
          1500,
        );
      }),
    ]);
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
    void storage.close().catch(() => {});
  }
  if (failed) throw new OfflineStorageError('unavailable');
}
export type OfflineCacheLockResult = 'completed' | 'busy' | 'unavailable';
export async function withOfflineCacheLock(
  operation: () => Promise<void>,
): Promise<OfflineCacheLockResult> {
  // Browser caching requires actual cross-tab exclusion, not an advisory query.
  if (typeof navigator === 'undefined' || !navigator.locks)
    return 'unavailable';
  if (hasMutationIntent()) return 'busy';
  return navigator.locks.request(
    mutationLockName,
    { mode: 'shared', ifAvailable: true },
    async (lock) => {
      if (!lock || hasMutationIntent()) return 'busy';
      await operation();
      return 'completed';
    },
  );
}
export async function withOfflineDevicePurge<T>(
  operation: () => Promise<T>,
  onCleanupFailure?: () => void,
): Promise<T> {
  const cleanup = async () => {
    try {
      await purgeOfflineDevice();
    } catch {
      try {
        onCleanupFailure?.();
      } catch {
        /* Cleanup reporting cannot replace the operation result. */
      }
    }
  };
  // Conceal and durably block before waiting for an existing cache read to abort.
  pendingDeviceMutations++;
  let intentKey: string | undefined;
  let intentStored = false;
  try {
    try {
      intentKey = mutationIntentPrefix + crypto.randomUUID();
      globalThis.localStorage.setItem(intentKey, 'pending');
      intentStored = true;
    } catch {
      // Authentication still executes when browser storage is inaccessible.
      try {
        onCleanupFailure?.();
      } catch {
        /* Reporting cannot replace intent. */
      }
    }
    notifyOfflineBlocked();
    await cleanup();
    const run = async () => {
      await cleanup();
      try {
        return await operation();
      } finally {
        await cleanup();
      }
    };
    if (typeof navigator !== 'undefined' && navigator.locks) {
      let entered = false;
      try {
        return await navigator.locks.request(mutationLockName, async () => {
          entered = true;
          return run();
        });
      } catch (error) {
        if (entered) throw error; // Never replay an operation that already started.
        return await run();
      }
    }
    return await run();
  } finally {
    if (intentStored && intentKey) {
      try {
        globalThis.localStorage.removeItem(intentKey);
      } catch {
        /* A lingering durable intent keeps cache reads blocked. */
      }
    }
    pendingDeviceMutations--;
  }
}
export class OfflineStorageError extends Error {
  constructor(
    public readonly reason: 'unavailable' | 'fence' | 'expired' | 'quota',
  ) {
    super(`Offline storage ${reason}`);
  }
}
export interface StoredPhoto {
  id: string;
  bytes: Blob;
}
export interface StoredOfflineFile {
  id: string;
  label: string;
  kind: 'pdf' | 'video';
  bytes: Blob;
  savedAt: number;
  fence: CacheFence;
}
export const offlineFileLimits = {
  bytes: 300 * 1024 * 1024,
  count: 30,
  singleBytes: 256 * 1024 * 1024,
} as const;
export function validOfflineFiles(
  files: StoredOfflineFile[],
  fence: CacheFence,
) {
  return (
    files.every(
      (file) =>
        file.fence.partition === fence.partition &&
        file.fence.generation === fence.generation &&
        file.fence.deviceEpoch === fence.deviceEpoch &&
        file.bytes instanceof Blob &&
        file.bytes.size > 0 &&
        file.bytes.size <= offlineFileLimits.singleBytes &&
        file.bytes.type ===
          (file.kind === 'pdf' ? 'application/pdf' : 'video/mp4'),
    ) &&
    files.length <= offlineFileLimits.count &&
    new Set(files.map((file) => file.id)).size === files.length &&
    files.reduce((sum, file) => sum + file.bytes.size, 0) <=
      offlineFileLimits.bytes
  );
}
export class OfflineStorage {
  private database?: Promise<IDBDatabase>;
  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly gateStorage: Storage | undefined = browserGateStorage(),
  ) {}
  private open(): Promise<IDBDatabase> {
    if (!this.factory)
      return Promise.reject(new OfflineStorageError('unavailable'));
    return (this.database ??= new Promise((resolve, reject) => {
      const request = this.factory!.open(databaseName, 3);
      request.onupgradeneeded = () => {
        for (const name of stores)
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(new OfflineStorageError('unavailable'));
      };
      request.onblocked = () => {
        this.database = undefined;
        reject(new OfflineStorageError('unavailable'));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.addEventListener?.('close', () => {
          this.database = undefined;
        });
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
    }));
  }
  private async transaction<T>(
    action: (
      transaction: IDBTransaction,
      metadata: CacheMetadata,
      finish: (value: T) => void,
      fail: (error: OfflineStorageError) => void,
    ) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(stores, 'readwrite');
      } catch {
        this.database = undefined;
        db.close();
        reject(new OfflineStorageError('unavailable'));
        return;
      }
      let result: T;
      let failure: OfflineStorageError | undefined;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => {
        if (transaction.error?.name !== 'QuotaExceededError') {
          this.database = undefined;
          db.close();
        }
        reject(
          failure ??
            new OfflineStorageError(
              transaction.error?.name === 'QuotaExceededError'
                ? 'quota'
                : 'unavailable',
            ),
        );
      };
      transaction.onerror = () => {
        /* Abort is the single rejection path. */
      };
      const request = transaction.objectStore('metadata').get('current');
      request.onsuccess = () => {
        try {
          let metadata: CacheMetadata = request.result ?? initialMetadata();
          if (
            metadata.weightPolicyVersion !==
            ownerConfirmedYazioWeightPolicyVersion
          ) {
            metadata = {
              ...metadata,
              weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
              generation: metadata.generation + 1,
            };
            transaction.objectStore('metadata').put(metadata, 'current');
            transaction.objectStore('bundle').clear();
            transaction.objectStore('photos').clear();
            transaction.objectStore('files').clear();
            transaction.objectStore('resources').clear();
          }
          action(
            transaction,
            metadata,
            (value) => {
              result = value;
            },
            (error) => {
              failure = error;
              transaction.abort();
            },
          );
        } catch {
          failure = new OfflineStorageError('unavailable');
          transaction.abort();
        }
      };
    });
  }
  metadata() {
    return this.transaction<CacheMetadata>((_tx, metadata, finish) => {
      const gate = readGate(this.gateStorage);
      finish({
        ...metadata,
        enabled:
          metadata.enabled &&
          !hasMutationIntent(this.gateStorage) &&
          !memoryBlocked &&
          !gate.disabled &&
          gate.epoch === metadata.deviceEpoch,
      });
    });
  }
  currentFence() {
    return this.transaction<CacheFence>((_tx, metadata, finish, fail) => {
      const gate = readGate(this.gateStorage);
      if (
        hasMutationIntent(this.gateStorage) ||
        memoryBlocked ||
        gate.disabled ||
        !metadata.enabled ||
        !metadata.partition
      )
        return fail(new OfflineStorageError('fence'));
      finish({
        partition: metadata.partition,
        generation: metadata.generation,
        deviceEpoch: gate.epoch,
      });
    });
  }
  purge(now = Date.now(), previousEpoch?: string) {
    return this.transaction<CacheMetadata>((tx, metadata, finish) => {
      if (
        previousEpoch !== undefined &&
        metadata.deviceEpoch !== null &&
        metadata.deviceEpoch !== previousEpoch
      ) {
        finish(metadata);
        return;
      }
      const next = nextMetadata(metadata, now);
      tx.objectStore('metadata').put(next, 'current');
      tx.objectStore('bundle').clear();
      tx.objectStore('photos').clear();
      tx.objectStore('files').clear();
      tx.objectStore('resources').clear();
      finish(next);
    });
  }
  enable(partition: string, connectionGeneration: string, now = Date.now()) {
    if (hasMutationIntent(this.gateStorage))
      throw new OfflineStorageError('fence');
    const gate = { epoch: crypto.randomUUID(), disabled: false };
    writeGate(this.gateStorage, gate);
    memoryBlocked = false;
    return this.transaction<CacheFence>((tx, metadata, finish, fail) => {
      if (
        hasMutationIntent(this.gateStorage) ||
        readGate(this.gateStorage).epoch !== gate.epoch ||
        readGate(this.gateStorage).disabled ||
        memoryBlocked
      )
        return fail(new OfflineStorageError('fence'));
      if (now < metadata.lastSeenAt)
        return fail(new OfflineStorageError('expired'));
      const next = {
        ...nextMetadata(metadata, now),
        partition,
        connectionGeneration,
        enabled: true,
        lastSeenAt: now,
        deviceEpoch: gate.epoch,
      };
      tx.objectStore('metadata').put(next, 'current');
      tx.objectStore('bundle').clear();
      tx.objectStore('photos').clear();
      tx.objectStore('files').clear();
      tx.objectStore('resources').clear();
      finish({
        partition,
        generation: next.generation,
        deviceEpoch: gate.epoch,
      });
    });
  }
  commit(
    bundle: CachedBundle<OfflineSnapshot>,
    photos: StoredPhoto[],
    now = Date.now(),
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {
    return this.transaction<void>((tx, metadata, finish, fail) => {
      const gate = readGate(this.gateStorage);
      if (
        hasMutationIntent(this.gateStorage) ||
        memoryBlocked ||
        gate.disabled ||
        gate.epoch !== bundle.fence.deviceEpoch
      )
        return fail(new OfflineStorageError('fence'));
      if (!matchesFence(metadata, bundle.fence))
        return fail(new OfflineStorageError('fence'));
      if (!canReadBundle(metadata, bundle, now))
        return fail(new OfflineStorageError('expired'));
      const total = photos.reduce((sum, photo) => sum + photo.bytes.size, 0);
      if (
        total !== bundle.photoBytes ||
        total > offlineDeviceLimits.photoBytes ||
        new Set(photos.map((photo) => photo.id)).size !== photos.length
      )
        return fail(new OfflineStorageError('quota'));
      const snapshot = pruneOfflineSnapshot(
        offlineSnapshotSchema.parse(bundle.snapshot),
        offlineLocalWindow(now, timezone),
      );
      if (
        new TextEncoder().encode(JSON.stringify(snapshot)).length >
        offlineLimits.payloadBytes
      )
        return fail(new OfflineStorageError('quota'));
      const ids = new Set(snapshot.photos.items.map((photo) => photo.id));
      const retained = photos.filter((photo) => ids.has(photo.id));
      const nextBundle = {
        ...bundle,
        snapshot,
        missingPhotos: bundle.missingPhotos.filter((id) => ids.has(id)),
        photoBytes: retained.reduce((sum, photo) => sum + photo.bytes.size, 0),
      };
      tx.objectStore('bundle').put(nextBundle, 'current');
      tx.objectStore('photos').clear();
      for (const photo of retained)
        tx.objectStore('photos').put(photo.bytes, photo.id);
      tx.objectStore('metadata').put(
        { ...metadata, lastSeenAt: now },
        'current',
      );
      finish();
    });
  }
  read(
    now = Date.now(),
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {
    return this.transaction<{
      metadata: CacheMetadata;
      bundle: CachedBundle<OfflineSnapshot> | null;
      photos: StoredPhoto[];
      files?: StoredOfflineFile[];
    }>((tx, metadata, finish, fail) => {
      const request = tx.objectStore('bundle').get('current');
      request.onsuccess = () => {
        try {
          let bundle: CachedBundle<OfflineSnapshot> | undefined =
            request.result;
          const gate = readGate(this.gateStorage);
          if (
            hasMutationIntent(this.gateStorage) ||
            memoryBlocked ||
            gate.disabled ||
            (metadata.enabled && gate.epoch !== metadata.deviceEpoch)
          ) {
            const next = nextMetadata(metadata, now);
            tx.objectStore('metadata').put(next, 'current');
            tx.objectStore('bundle').clear();
            tx.objectStore('photos').clear();
            tx.objectStore('files').clear();
            tx.objectStore('resources').clear();
            return finish({ metadata: next, bundle: null, photos: [] });
          }
          if (!bundle) return finish({ metadata, bundle: null, photos: [] });
          const parsed = offlineSnapshotSchema.safeParse(bundle.snapshot);
          if (
            bundle.schemaVersion !== 2 ||
            bundle.weightPolicyVersion !==
              ownerConfirmedYazioWeightPolicyVersion ||
            !parsed.success
          ) {
            const next = { ...metadata, generation: metadata.generation + 1 };
            tx.objectStore('metadata').put(next, 'current');
            tx.objectStore('bundle').clear();
            tx.objectStore('photos').clear();
            tx.objectStore('files').clear();
            tx.objectStore('resources').clear();
            return finish({ metadata: next, bundle: null, photos: [] });
          }
          const snapshot = pruneOfflineSnapshot(
            parsed.data,
            offlineLocalWindow(now, timezone),
          );
          const ids = new Set(snapshot.photos.items.map((photo) => photo.id));
          bundle = {
            ...bundle,
            snapshot,
            missingPhotos: bundle.missingPhotos.filter((id) => ids.has(id)),
          };
          if (
            hasMutationIntent(this.gateStorage) ||
            memoryBlocked ||
            gate.disabled ||
            gate.epoch !== bundle.fence.deviceEpoch ||
            !canReadBundle(metadata, bundle, now)
          ) {
            const next = nextMetadata(metadata, now);
            tx.objectStore('metadata').put(next, 'current');
            tx.objectStore('bundle').clear();
            tx.objectStore('photos').clear();
            tx.objectStore('files').clear();
            tx.objectStore('resources').clear();
            return finish({ metadata: next, bundle: null, photos: [] });
          }
          const photos: StoredPhoto[] = [];
          const filesRequest = tx.objectStore('files').getAll();
          const cursor = tx.objectStore('photos').openCursor();
          cursor.onsuccess = () => {
            try {
              const current = cursor.result;
              if (current) {
                if (ids.has(String(current.key)))
                  photos.push({
                    id: String(current.key),
                    bytes: current.value,
                  });
                else current.delete();
                current.continue();
              } else {
                const latestGate = readGate(this.gateStorage);
                if (
                  memoryBlocked ||
                  latestGate.disabled ||
                  latestGate.epoch !== bundle.fence.deviceEpoch
                )
                  return fail(new OfflineStorageError('fence'));
                const next = { ...metadata, lastSeenAt: now };
                tx.objectStore('metadata').put(next, 'current');
                const retained = {
                  ...bundle!,
                  photoBytes: photos.reduce(
                    (sum, photo) => sum + photo.bytes.size,
                    0,
                  ),
                };
                tx.objectStore('bundle').put(retained, 'current');
                const files = filesRequest.result as StoredOfflineFile[];
                if (!validOfflineFiles(files, retained.fence)) {
                  tx.objectStore('files').clear();
                  tx.objectStore('resources').clear();
                  finish({
                    metadata: next,
                    bundle: retained,
                    photos,
                    files: [],
                  });
                } else
                  finish({ metadata: next, bundle: retained, photos, files });
              }
            } catch {
              fail(new OfflineStorageError('unavailable'));
            }
          };
        } catch {
          fail(new OfflineStorageError('unavailable'));
        }
      };
    });
  }
  writeFile(file: StoredOfflineFile | { id: string; fence: CacheFence }) {
    return this.transaction<void>((tx, metadata, finish, fail) => {
      const gate = readGate(this.gateStorage);
      if (
        hasMutationIntent(this.gateStorage) ||
        memoryBlocked ||
        gate.disabled ||
        gate.epoch !== file.fence.deviceEpoch ||
        !matchesFence(metadata, file.fence)
      )
        return fail(new OfflineStorageError('fence'));
      const request = tx.objectStore('files').getAll();
      request.onsuccess = () => {
        const remaining = (request.result as StoredOfflineFile[]).filter(
          (row) => row.id !== file.id,
        );
        if ('bytes' in file) {
          if (!validOfflineFiles([...remaining, file], file.fence))
            return fail(new OfflineStorageError('quota'));
          tx.objectStore('files').put(file, file.id);
        } else tx.objectStore('files').delete(file.id);
        finish();
      };
    });
  }
  readResources(fence: CacheFence, now = Date.now()) {
    return this.transaction<ReadRecord[]>((tx, metadata, finish, fail) => {
      if (!matchesFence(metadata, fence))
        return fail(new OfflineStorageError('fence'));
      if (Date.now() < metadata.lastSeenAt)
        return fail(new OfflineStorageError('expired'));
      const gate = readGate(this.gateStorage);
      if (
        memoryBlocked ||
        hasMutationIntent(this.gateStorage) ||
        gate.disabled ||
        gate.epoch !== fence.deviceEpoch
      )
        return fail(new OfflineStorageError('fence'));
      const store = tx.objectStore('resources');
      const request = store.getAll();
      request.onsuccess = () => {
        const valid = request.result.flatMap((row: unknown) => {
          const value = readRecordSchema.safeParse(row);
          return value.success ? [value.data] : [];
        });
        const rows = pruneReadRecords(valid, now);
        store.clear();
        for (const row of rows) store.put(row, row.key);
        finish(rows);
      };
    });
  }
  removeResource(fence: CacheFence, key: string) {
    return this.transaction<void>((tx, metadata, finish, fail) => {
      if (!matchesFence(metadata, fence))
        return fail(new OfflineStorageError('fence'));
      tx.objectStore('resources').delete(key);
      finish();
    });
  }
  writeResource(fence: CacheFence, record: ReadRecord) {
    return this.transaction<void>((tx, metadata, finish, fail) => {
      if (!matchesFence(metadata, fence))
        return fail(new OfflineStorageError('fence'));
      if (Date.now() < metadata.lastSeenAt)
        return fail(new OfflineStorageError('expired'));
      const gate = readGate(this.gateStorage);
      if (
        memoryBlocked ||
        hasMutationIntent(this.gateStorage) ||
        gate.disabled ||
        gate.epoch !== fence.deviceEpoch
      )
        return fail(new OfflineStorageError('fence'));
      const store = tx.objectStore('resources');
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = request.result.flatMap((value: unknown) => {
          const parsed = readRecordSchema.safeParse(value);
          return parsed.success && parsed.data.key !== record.key
            ? [parsed.data]
            : [];
        });
        const retained = pruneReadRecords(
          [readRecordSchema.parse(record), ...rows],
          Date.now(),
        );
        if (!retained.some((row) => row.key === record.key)) {
          finish();
          return;
        }
        store.clear();
        for (const row of retained) store.put(row, row.key);
        finish();
      };
    });
  }
  async close() {
    (await this.database)?.close();
    this.database = undefined;
  }
}
export function observeOfflineDenials() {
  const original = window.fetch;
  const observed: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      window.location.origin,
    );
    const relevant =
      url.origin === window.location.origin && url.pathname.startsWith('/api/');
    let response: Response;
    try {
      response = await original.call(window, input, init);
    } catch (error) {
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (
        relevant &&
        (!signal?.aborted || signal.reason?.name === 'TimeoutError')
      )
        reportNetworkResult(false);
      throw error;
    }
    if (relevant) {
      // Receiving HTTP proves transport reachability. A failed cache preparation
      // is a resource error, never a reason to replace live navigation.
      reportNetworkResult(true);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      if (
        response.ok &&
        !url.pathname.startsWith('/api/offline/') &&
        !/\/(?:video|preview|playback|parts)(?:\/|$)/.test(url.pathname) &&
        /^\/api\/(?:nutrition|measurements|workouts|health|overview|yazio|transformmate|comments|settings)(?:\/|$)/.test(
          url.pathname,
        ) &&
        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)
      )
        window.dispatchEvent(new Event('tempo:offline-source-loaded'));
    }
    try {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        window.location.origin,
      );
      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith('/api/') &&
        (response.status === 401 || response.status === 403)
      ) {
        window.dispatchEvent(new Event('tempo:read-access-denied'));
        void purgeOfflineDevice()
          .catch(() => {})
          .then(() => {
            if (!/^\/api\/offline\/(?:identity|snapshot)$/.test(url.pathname))
              window.dispatchEvent(new Event('tempo:read-access-recheck'));
          });
      }
    } catch {
      /* Observing status never changes a request or response. */
    }
    return response;
  };
  window.fetch = observed;
  return () => {
    if (window.fetch === observed) window.fetch = original;
  };
}
