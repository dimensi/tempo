import { expect, it } from 'vitest';
import {
  OfflineStorage,
  validOfflineFiles,
  type CachedBundle,
  type StoredOfflineFile,
} from '@/lib/offline-device';
import type { OfflineSnapshot } from '@/contracts/offline';
import { offlineFixture } from '../offline/fixtures';

// Minimal deterministic IndexedDB driver. Transactions clone their stores and
// publish only on complete, so abort/quota tests exercise the real storage code.
function indexedDBDriver() {
  const data = new Map<string, Map<IDBValidKey, unknown>>();
  let failPut: string | undefined;
  const db = {
    objectStoreNames: { contains: (name: string) => data.has(name) },
    createObjectStore: (name: string) => data.set(name, new Map()),
    close() {},
    transaction(names: string[]) {
      const draft = new Map(
        names.map((name) => [name, new Map(data.get(name))]),
      );
      let pending = 0;
      let stopped = false;
      const tx = {
        oncomplete: undefined as undefined | (() => void),
        onabort: undefined as undefined | (() => void),
        error: null as null | { name: string },
        abort() {
          stopped = true;
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name: string) {
          const store = draft.get(name)!;
          function request(value: () => unknown) {
            const result = {
              result: undefined as unknown,
              onsuccess: undefined as undefined | (() => void),
            };
            pending++;
            queueMicrotask(() => {
              if (stopped) return;
              result.result = value();
              result.onsuccess?.();
              pending--;
              queueMicrotask(() => {
                if (!stopped && pending === 0) {
                  stopped = true;
                  for (const [name, rows] of draft) data.set(name, rows);
                  tx.oncomplete?.();
                }
              });
            });
            return result;
          }
          return {
            get: (key: IDBValidKey) => request(() => store.get(key)),
            getAll: () => request(() => [...store.values()]),
            put(value: unknown, key: IDBValidKey) {
              return request(() => {
                if (failPut === name) {
                  failPut = undefined;
                  tx.error = { name: 'QuotaExceededError' };
                  tx.abort();
                  return;
                }
                store.set(key, value);
              });
            },
            clear: () => request(() => store.clear()),
            delete: (key: IDBValidKey) => request(() => store.delete(key)),
            openCursor() {
              const keys = [...store.keys()];
              let index = 0;
              const result = {
                result: undefined as unknown,
                onsuccess: undefined as undefined | (() => void),
              };
              function next() {
                const current = request(() =>
                  index < keys.length
                    ? {
                        key: keys[index]!,
                        value: store.get(keys[index]!),
                        delete: () => store.delete(keys[index]!),
                        continue: () => {
                          index++;
                          next();
                        },
                      }
                    : null,
                );
                current.onsuccess = () => {
                  result.result = current.result;
                  result.onsuccess?.();
                };
              }
              next();
              return result;
            },
          };
        },
      };
      return tx;
    },
  };
  const factory = {
    open() {
      const request = {
        result: db,
        onupgradeneeded: undefined as undefined | (() => void),
        onsuccess: undefined as undefined | (() => void),
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  const gate = new Map<string, string>();
  const localStorage = {
    get length() {
      return gate.size;
    },
    key: (i: number) => [...gate.keys()][i] ?? null,
    getItem: (key: string) => gate.get(key) ?? null,
    setItem: (key: string, value: string) => {
      gate.set(key, value);
    },
    removeItem: (key: string) => gate.delete(key),
    clear: () => gate.clear(),
  };
  return {
    storage: new OfflineStorage(factory as unknown as IDBFactory, localStorage),
    data,
    failFilesPut: () => {
      failPut = 'files';
    },
  };
}
const now = Date.parse('2026-10-12T12:00:00Z');
async function prepared() {
  const driver = indexedDBDriver();
  const snapshot = offlineFixture(now);
  const fence = await driver.storage.enable(
    snapshot.partition,
    snapshot.connectionGeneration,
    now,
  );
  const bundle: CachedBundle<OfflineSnapshot> = {
    schemaVersion: 2,
    weightPolicyVersion: snapshot.weightPolicyVersion,
    fence,
    snapshot,
    savedAt: now,
    expiresAt: now + 1000,
    sessionExpiresAt: now + 1000,
    photoBytes: 0,
    missingPhotos: [],
  };
  await driver.storage.commit(bundle, [], now, 'UTC');
  const file: StoredOfflineFile = {
    id: 'report:today',
    label: 'Report',
    kind: 'pdf',
    bytes: new Blob(['%PDF-copy'], { type: 'application/pdf' }),
    savedAt: now,
    fence,
  };
  return { ...driver, bundle, file };
}
it('stores actual file bytes, preserves files during refresh and deletes only a selected copy', async () => {
  const { storage, bundle, file } = await prepared();
  await storage.writeFile(file);
  await storage.commit(bundle, [], now, 'UTC');
  const cached = await storage.read(now, 'UTC');
  expect(await cached.files![0]!.bytes.text()).toBe('%PDF-copy');
  await storage.writeFile({ id: file.id, fence: bundle.fence });
  const after = await storage.read(now, 'UTC');
  expect(after.files).toEqual([]);
  expect(after.bundle?.snapshot.diary).toHaveLength(1);
});
it('purge and account replacement physically remove files, photos and presentation data', async () => {
  const { storage, data, file } = await prepared();
  await storage.writeFile(file);
  await storage.purge(now);
  for (const name of ['bundle', 'photos', 'files'])
    expect(data.get(name)?.size).toBe(0);
  expect((await storage.metadata()).enabled).toBe(false);
  const fence = await storage.enable('other-account', 'other-scope', now);
  await expect(storage.writeFile(file)).rejects.toMatchObject({
    reason: 'fence',
  });
  await storage.writeFile({ ...file, fence });
  await storage.enable('third-account', 'third-scope', now);
  expect(data.get('files')?.size).toBe(0);
});
it('quota failure is atomic and leaves the existing diary and file readable', async () => {
  const { storage, file, failFilesPut } = await prepared();
  await storage.writeFile(file);
  failFilesPut();
  await expect(
    storage.writeFile({ ...file, id: 'second' }),
  ).rejects.toMatchObject({ reason: 'quota' });
  const cached = await storage.read(now, 'UTC');
  expect(cached.bundle?.snapshot.diary).toHaveLength(1);
  expect(cached.files?.map((file) => file.id)).toEqual([file.id]);
});
it('old DTOs and foreign file fences are erased; a signed URL never counts as bytes', async () => {
  const { storage, data, bundle, file } = await prepared();
  expect(
    validOfflineFiles(
      [
        {
          ...file,
          bytes: 'https://cdn.test/file?token=secret' as unknown as Blob,
        },
      ],
      bundle.fence,
    ),
  ).toBe(false);
  expect(
    validOfflineFiles(
      [{ ...file, fence: { ...file.fence, partition: 'foreign' } }],
      bundle.fence,
    ),
  ).toBe(false);
  data
    .get('files')!
    .set(file.id, { ...file, fence: { ...file.fence, deviceEpoch: 'old' } });
  expect((await storage.read(now, 'UTC')).files).toEqual([]);
  await storage.writeFile(file);
  data.get('bundle')!.set('current', {
    ...bundle,
    snapshot: { ...bundle.snapshot, contractVersion: 1 },
  });
  expect((await storage.read(now, 'UTC')).bundle).toBeNull();
  for (const name of ['bundle', 'photos', 'files'])
    expect(data.get(name)?.size).toBe(0);
});

it('read-resource data shares the read fence, is cleaned on account replacement and rejects stale writes', async () => {
  const { storage, data, bundle } = await prepared();
  const stamp = Date.now();
  const record = {
    version: 2 as const,
    coverage: 'complete' as const,
    key: '/api/anamnesis/markers?ownerId=owner',
    body: '[]',
    savedAt: stamp,
    touchedAt: stamp,
  };
  await storage.writeResource(bundle.fence, record);
  expect(await storage.readResources(bundle.fence, stamp)).toEqual([record]);
  const next = await storage.enable('new-owner', 'new-generation', stamp);
  expect(data.get('resources')?.size).toBe(0);
  await expect(
    storage.writeResource(bundle.fence, record),
  ).rejects.toMatchObject({ reason: 'fence' });
  await storage.writeResource(next, record);
  await storage.purge(stamp);
  expect(data.get('resources')?.size).toBe(0);
});
it('resource eviction is bounded and cannot remove the diary or saved file bytes', async () => {
  const { storage, bundle, file } = await prepared();
  await storage.writeFile(file);
  const stamp = Date.now();
  await storage.writeResource(bundle.fence, {
    version: 2,
    coverage: 'complete',
    key: '/api/anamnesis/markers/x',
    body: '{}',
    savedAt: stamp - 16 * 86400000,
    touchedAt: stamp - 16 * 86400000,
  });
  expect(await storage.readResources(bundle.fence, stamp)).toEqual([]);
  const retained = await storage.read(now, 'UTC');
  expect(retained.bundle?.snapshot.diary).toHaveLength(1);
  expect(retained.files?.[0]?.bytes).toBeInstanceOf(Blob);
});
