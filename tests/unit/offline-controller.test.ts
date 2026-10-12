import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/offline-device', async (importOriginal) => ({
  ...(await importOriginal()),
  purgeOfflineDevice: vi.fn(async () => {}),
}));
import { OfflineController } from '@/features/offline/controller';
import {
  initialMetadata,
  purgeOfflineDevice,
  type OfflineStorage,
  type CachedBundle,
  type CacheMetadata,
} from '@/lib/offline-device';
import { offlineFixture } from '../offline/fixtures';
import type { OfflineSnapshot } from '@/contracts/offline';
const now = Date.parse('2026-10-12T12:00:00Z');
const fixture = offlineFixture(now);
function storage() {
  let metadata: CacheMetadata = initialMetadata();
  let bundle: CachedBundle<OfflineSnapshot> | null = null;
  const commit = vi.fn(async (value: CachedBundle<OfflineSnapshot>) => {
    bundle = value;
  });
  return {
    commit,
    metadata: async () => metadata,
    enable: async (partition: string, connectionGeneration: string) => {
      metadata = {
        ...metadata,
        enabled: true,
        partition,
        connectionGeneration,
        generation: metadata.generation + 1,
        deviceEpoch: 'epoch',
      };
      return {
        partition,
        generation: metadata.generation,
        deviceEpoch: 'epoch',
      };
    },
    currentFence: async () => ({
      partition: metadata.partition!,
      generation: metadata.generation,
      deviceEpoch: 'epoch',
    }),
    read: async () => ({ metadata, bundle, photos: [] }),
  };
}
const identity = () =>
  new Response(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(fixture).filter(([key]) =>
          [
            'contractVersion',
            'partition',
            'connectionGeneration',
            'role',
            'serverNow',
            'sessionExpiresAt',
            'expiresAt',
          ].includes(key),
        ),
      ),
    ),
    { status: 200 },
  );
afterEach(() => vi.clearAllMocks());
it('requires fresh identity before opt-in and cache reads, requests date-only data and keeps zero/null', async () => {
  const persistence = storage();
  const fetcher = vi.fn(async (url: string) =>
    url === '/api/offline/identity'
      ? identity()
      : new Response(JSON.stringify(fixture)),
  );
  const controller = new OfflineController(
    persistence as unknown as OfflineStorage,
    fetcher as typeof fetch,
    () => now,
    async () => {},
  );
  await controller.save({ from: fixture.from, to: fixture.to });
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    '/api/offline/identity',
    `/api/offline/snapshot?from=${fixture.from}&to=${fixture.to}`,
    '/api/offline/identity',
  ]);
  expect(persistence.commit).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().bundle?.snapshot.dailySteps[0]?.steps).toBe(
    0,
  );
  expect(
    controller.getSnapshot().bundle?.snapshot.importedWeights[0]?.rawValue,
  ).toBeNull();
  fetcher.mockClear();
  await controller.activate(true);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/offline/identity',
    expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
  );
});
it('denials purge and never use cached data as fallback', async () => {
  const persistence = storage();
  const controller = new OfflineController(
    persistence as unknown as OfflineStorage,
    (async () => new Response('{}', { status: 403 })) as typeof fetch,
    () => now,
    async () => {},
  );
  await controller.activate(true);
  expect(purgeOfflineDevice).toHaveBeenCalledOnce();
  expect(controller.getSnapshot()).toMatchObject({
    bundle: null,
    photos: [],
    error: 'denied',
  });
});
it('a delayed snapshot cannot commit after logout-style invalidation', async () => {
  const persistence = storage();
  let release!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetcher = async (url: string) => {
    if (url === '/api/offline/identity') return identity();
    entered();
    return pending;
  };
  const controller = new OfflineController(
    persistence as unknown as OfflineStorage,
    fetcher as typeof fetch,
    () => now,
    async () => {},
  );
  const saving = controller.save({ from: fixture.from, to: fixture.to });
  await started;
  controller.invalidate();
  release(new Response(JSON.stringify(fixture)));
  await saving;
  expect(persistence.commit).not.toHaveBeenCalled();
  expect(controller.getSnapshot()).toMatchObject({
    status: 'disabled',
    bundle: null,
  });
});
it('network verification failure keeps the store but shows no private cached content', async () => {
  const persistence = storage();
  const controller = new OfflineController(
    persistence as unknown as OfflineStorage,
    (async () => {
      throw new TypeError('Network unavailable');
    }) as typeof fetch,
    () => now,
    async () => {},
  );
  await controller.activate(true);
  expect(purgeOfflineDevice).not.toHaveBeenCalled();
  expect(controller.getSnapshot()).toMatchObject({
    status: 'error',
    error: 'unavailable',
    bundle: null,
  });
});
