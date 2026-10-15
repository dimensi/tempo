import { expect, it, vi } from 'vitest';
import {
  ReadResourceStore,
  ReadFailure,
  type PersistedRead,
} from '@/lib/read-resource';
function setup() {
  const disk = new Map<string, PersistedRead<{ value: number }>>();
  const persistence = {
    read: vi.fn(async (key: string) => disk.get(key)),
    write: vi.fn(
      async (key: string, value: PersistedRead<{ value: number }>) => {
        disk.set(key, value);
      },
    ),
    remove: vi.fn(async (key: string) => {
      disk.delete(key);
    }),
  };
  return {
    disk,
    persistence,
    store: new ReadResourceStore(persistence, () => 100),
  };
}
it('a cache-only read cannot suppress a concurrent network refresh', async () => {
  const { store, persistence } = setup();
  const disk = Promise.withResolvers<
    PersistedRead<{ value: number }> | undefined
  >();
  persistence.read.mockImplementation(() => disk.promise);
  const cached = store.read('day');
  const loader = vi.fn(async () => ({ value: 2 }));
  const fresh = store.read('day', loader);
  disk.resolve({ data: { value: 1 }, savedAt: 40, touchedAt: 50 });
  await cached;
  expect(await fresh).toEqual({ value: 2 });
  expect(loader).toHaveBeenCalledTimes(1);
  expect(store.snapshot('day').data).toEqual({ value: 2 });
});
it('restores through the same read interface and keeps savedAt while recording a view', async () => {
  const { store, disk } = setup();
  disk.set('day', { data: { value: 0 }, savedAt: 40, touchedAt: 50 });
  expect(await store.read('day')).toEqual({ value: 0 });
  expect(store.snapshot('day')).toMatchObject({
    source: 'storage',
    savedAt: 40,
    coverage: 'complete',
  });
  expect(disk.get('day')).toMatchObject({ savedAt: 40, touchedAt: 100 });
});
it('coalesces concurrent loads and publishes replacement data without blanking the prior value', async () => {
  const { store } = setup();
  store.seed('day', { value: 1 });
  const response = Promise.withResolvers<{ value: number }>();
  const load = vi.fn(() => response.promise);
  const a = store.read('day', load),
    b = store.read('day', load);
  expect(load).toHaveBeenCalledTimes(1);
  expect(store.snapshot('day')).toMatchObject({
    data: { value: 1 },
    refreshing: true,
  });
  response.resolve({ value: 2 });
  expect(await a).toEqual({ value: 2 });
  expect(await b).toEqual({ value: 2 });
  expect(store.snapshot('day')).toMatchObject({
    data: { value: 2 },
    refreshing: false,
  });
});
it('network and service failures retain data, while a missing object stays missing', async () => {
  const { store } = setup();
  store.seed('known', { value: 3 });
  expect(
    await store.read('known', async () => {
      throw new ReadFailure('network');
    }),
  ).toEqual({ value: 3 });
  expect(store.snapshot('known')).toMatchObject({
    error: 'network',
    data: { value: 3 },
  });
  await expect(store.read('unknown')).rejects.toMatchObject({
    reason: 'network',
  });
  expect(store.snapshot('unknown').data).toBeUndefined();
});
it('denial and deletion never return a stale copy and remove its persistent record', async () => {
  for (const status of [401, 403, 404]) {
    const { store, disk } = setup();
    disk.set('private', { data: { value: 2 }, savedAt: 1, touchedAt: 1 });
    await expect(
      store.read('private', async () => {
        throw new ReadFailure(
          status === 404 ? 'unavailable' : 'denied',
          status,
        );
      }),
    ).rejects.toBeInstanceOf(ReadFailure);
    expect(disk.has('private')).toBe(false);
    expect(store.snapshot('private').data).toBeUndefined();
  }
});
it('an old account response cannot publish or overwrite a newly loaded account', async () => {
  const { store, persistence } = setup();
  const delayed = Promise.withResolvers<{ value: number }>();
  const old = store.read('same-route', () => delayed.promise);
  await Promise.resolve();
  await Promise.resolve();
  store.clear();
  expect(await store.read('same-route', async () => ({ value: 9 }))).toEqual({
    value: 9,
  });
  delayed.resolve({ value: 1 });
  await expect(old).rejects.toMatchObject({ reason: 'denied' });
  expect(store.snapshot('same-route').data).toEqual({ value: 9 });
  expect(persistence.write).toHaveBeenCalledTimes(1);
});
it('storage faults and quota failure do not discard the successful live model', async () => {
  const { store, persistence } = setup();
  persistence.read.mockRejectedValueOnce(new Error('closed'));
  persistence.write.mockRejectedValueOnce(new Error('quota'));
  expect(await store.read('day', async () => ({ value: 5 }))).toEqual({
    value: 5,
  });
  expect(await store.read('day')).toEqual({ value: 5 });
});
