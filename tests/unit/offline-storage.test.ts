import { OfflineStorage, type StoredOfflineFile } from '@/lib/offline-device';
import { afterEach, expect, it, vi } from 'vitest';
import { indexedDBDriver } from './helpers/browser-db';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const driver = indexedDBDriver();
  vi.stubGlobal('indexedDB', driver.factory);
  return { ...driver, storage: new OfflineStorage() };
}
const file = (id: string, partition = 'owner'): StoredOfflineFile => ({
  id,
  label: id,
  kind: 'pdf',
  bytes: new Blob(['pdf'], { type: 'application/pdf' }),
  savedAt: 1,
  fence: { partition, generation: 0, deviceEpoch: '' },
});
it('retains explicitly saved file bytes across storage reopening and separates accounts', async () => {
  const { storage } = setup();
  await storage.writeFile(file('one'));
  await storage.writeFile(file('other', 'other'));
  expect(
    (await new OfflineStorage().files('owner')).map((row) => row.id),
  ).toEqual(['one']);
  expect(
    (await new OfflineStorage().files('other')).map((row) => row.id),
  ).toEqual(['other']);
});
it('a failed file replacement preserves the previous committed bytes', async () => {
  const { storage, failFilesPut } = setup();
  await storage.writeFile(file('one'));
  failFilesPut();
  await expect(
    storage.writeFile({
      ...file('one'),
      bytes: new Blob(['replacement'], { type: 'application/pdf' }),
    }),
  ).rejects.toBeDefined();
  expect(await (await storage.files('owner'))[0]!.bytes.text()).toBe('pdf');
});
it('purges read/file stores without deleting a separate write database', async () => {
  const { storage, data } = setup();
  await storage.writeFile(file('one'));
  data.set('queue-other-database', new Map([['pending', { id: 'pending' }]]));
  await storage.purge();
  expect(await storage.files('owner')).toEqual([]);
  expect(data.get('queue-other-database')?.size).toBe(1);
});

it('a session change before the file transaction completes prevents a late save', async () => {
  const { storage } = setup();
  const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  await expect(storage.writeFile(file('late'), current)).rejects.toBeDefined();
  expect(await storage.files('owner')).toEqual([]);
});
