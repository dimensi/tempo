import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/offline-device', async (importOriginal) => ({
  ...(await importOriginal()),
  purgeOfflineDevice: vi.fn(async () => {}),
  withOfflineCacheLock: vi.fn(async (operation: () => Promise<void>) => {
    await operation();
    return 'completed';
  }),
}));
import { OfflineController } from '@/lib/offline-controller';
import {
  initialMetadata,
  nextMetadata,
  purgeOfflineDevice,
  canReadBundle,
  type OfflineStorage,
  type CachedBundle,
  type CacheMetadata,
  type StoredOfflineFile,
} from '@/lib/offline-device';
import {
  offlineLocalWindow,
  pruneOfflineSnapshot,
} from '@/contracts/offline-retention';
import { ownerConfirmedYazioWeightPolicyVersion } from '@/contracts/yazio-weight-policy';
import { offlineFixture } from '../offline/fixtures';
import type { OfflineSnapshot } from '@/contracts/offline';
const now = Date.parse('2026-10-12T12:00:00Z');
const fixture = offlineFixture(now);
function storage() {
  let metadata: CacheMetadata = initialMetadata();
  let files: StoredOfflineFile[] = [];
  let bundle: CachedBundle<OfflineSnapshot> | null = null;
  const commit = vi.fn(async (value: CachedBundle<OfflineSnapshot>) => {
    bundle = value;
  });
  return {
    commit,
    writeFile: vi.fn(async (file: StoredOfflineFile | { id: string }) => {
      files = files.filter((row) => row.id !== file.id);
      if ('bytes' in file) files.push(file);
    }),
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
    purge: async () => {
      bundle = null;
      metadata = nextMetadata(metadata, now);
    },
    read: vi.fn(async (time = now, timezone = 'UTC') => {
      if (bundle && !canReadBundle(metadata, bundle, time)) {
        bundle = null;
        metadata = nextMetadata(metadata, time);
      }
      if (bundle)
        bundle = {
          ...bundle,
          snapshot: pruneOfflineSnapshot(
            bundle.snapshot,
            offlineLocalWindow(time, timezone),
          ),
        };
      return { metadata, bundle, photos: [], files };
    }),
  };
}
function identity() {
  const {
    contractVersion,
    weightPolicyVersion,
    partition,
    connectionGeneration,
    role,
    serverNow,
    sessionExpiresAt,
    expiresAt,
  } = fixture;
  return new Response(
    JSON.stringify({
      contractVersion,
      weightPolicyVersion,
      partition,
      connectionGeneration,
      role,
      serverNow,
      sessionExpiresAt,
      expiresAt,
    }),
  );
}
function fetcher() {
  return vi.fn(async (url: string) =>
    url === '/api/offline/identity'
      ? identity()
      : new Response(JSON.stringify(fixture)),
  );
}
const controller = (
  persistence: ReturnType<typeof storage>,
  fetch: typeof globalThis.fetch,
  clock = () => now,
) =>
  new OfflineController(
    persistence as unknown as OfflineStorage,
    fetch,
    clock,
    async () => {},
    () => 'UTC',
  );
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('a stale online flag cannot block the saved copy behind an unresponsive identity request', async () => {
  const persistence = storage();
  await controller(persistence, fetcher() as typeof fetch).save();
  vi.useFakeTimers();
  const reader = controller(
    persistence,
    async () => new Promise<Response>(() => {}),
  );
  const loading = reader.activate(true);
  await vi.advanceTimersByTimeAsync(2001);
  await loading;
  expect(reader.getSnapshot()).toMatchObject({
    status: 'offline',
    enabled: true,
  });
  expect(reader.getSnapshot().bundle?.snapshot.diary).toHaveLength(1);
  expect(purgeOfflineDevice).not.toHaveBeenCalled();
});
it('switching to local navigation supersedes an in-flight online verification', async () => {
  const persistence = storage();
  await controller(persistence, fetcher() as typeof fetch).save();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reader = controller(persistence, async () => {
    entered();
    return new Promise<Response>(() => {});
  });
  const online = reader.activate(true);
  await started;
  await reader.activate(false, true);
  await online;
  expect(reader.getSnapshot().status).toBe('offline');
  expect(reader.getSnapshot().bundle?.snapshot.diary).toHaveLength(1);
  expect(purgeOfflineDevice).not.toHaveBeenCalled();
});
it('explicit opt-in verifies OWNER and always requests rolling15 date-only data, preserving zero/null/kg policy', async () => {
  const persistence = storage();
  const request = fetcher();
  const reader = controller(persistence, request as typeof fetch);
  await reader.save();
  expect(request.mock.calls.map((call) => call[0])).toEqual([
    '/api/offline/identity',
    `/api/offline/snapshot?from=${fixture.from}&to=${fixture.to}`,
    '/api/offline/identity',
  ]);
  expect(persistence.commit).toHaveBeenCalledOnce();
  expect(reader.getSnapshot()).toMatchObject({
    enabled: true,
    status: 'ready',
  });
  expect(reader.getSnapshot().bundle?.snapshot.dailySteps[0]?.steps).toBe(0);
  expect(
    reader.getSnapshot().bundle?.snapshot.importedWeights[0],
  ).toMatchObject({
    rawValue: null,
    unit: 'kg',
    unitStatus: 'OWNER_CONFIRMED',
  });
});
it('OWNER startup automatically populates the copy; denial of an enabled cache purges before displaying content', async () => {
  const persistence = storage();
  const request = fetcher();
  const reader = controller(persistence, request as typeof fetch);
  await reader.activate(true);
  expect(request).toHaveBeenCalledTimes(3);
  expect(reader.getSnapshot().bundle).not.toBeNull();
  const denied = controller(
    persistence,
    (async () => new Response('{}', { status: 403 })) as typeof fetch,
  );
  await denied.activate(true);
  expect(purgeOfflineDevice).toHaveBeenCalledOnce();
  expect(denied.getSnapshot()).toMatchObject({
    enabled: false,
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
  const reader = controller(persistence, (async (url: string) => {
    if (url === '/api/offline/identity') return identity();
    entered();
    return pending;
  }) as typeof fetch);
  const saving = reader.save();
  await started;
  reader.invalidate();
  release(new Response(JSON.stringify(fixture)));
  await saving;
  expect(persistence.commit).not.toHaveBeenCalled();
  expect(reader.getSnapshot().bundle).toBeNull();
});
it('keeps denial visible when the physical purge invalidates its own active operation', async () => {
  const reader = controller(
    storage(),
    async () => new Response('{}', { status: 401 }),
  );
  vi.mocked(purgeOfflineDevice).mockImplementationOnce(async () =>
    reader.invalidate(),
  );
  await reader.activate(true);
  expect(reader.getSnapshot()).toMatchObject({
    status: 'error',
    error: 'denied',
    bundle: null,
    enabled: false,
  });
});
it('an expired server session does not expire downloaded offline copy; online denial is still required', async () => {
  const persistence = storage();
  let clock = now;
  const reader = controller(
    persistence,
    fetcher() as typeof fetch,
    () => clock,
  );
  await reader.save();
  const original = reader.getSnapshot().bundle!;
  clock = now + 3 * 86400000;
  const offline = controller(
    persistence,
    (async () => {
      throw new Error('offline must not fetch');
    }) as typeof fetch,
    () => clock,
  );
  await offline.activate(false);
  expect(offline.getSnapshot().bundle?.expiresAt).toBe(original.expiresAt);
  expect(offline.getSnapshot()).toMatchObject({
    enabled: true,
    status: 'offline',
  });
});
it('foreground event bursts are singleflight and snapshot refresh is bounded while open', async () => {
  const persistence = storage();
  let clock = now;
  const request = fetcher();
  const reader = controller(persistence, request as typeof fetch, () => clock);
  await reader.save();
  request.mockClear();
  clock += 31000;
  await Promise.all([
    reader.activate(true, true),
    reader.activate(true, true),
    reader.activate(true, true),
  ]);
  expect(request.mock.calls.map((call) => call[0])).toEqual([
    '/api/offline/identity',
  ]);
  clock += 300000;
  await reader.activate(true, true);
  expect(
    request.mock.calls.filter((call) =>
      call[0].startsWith('/api/offline/snapshot'),
    ),
  ).toHaveLength(1);
});
it('failed automatic save retains the saved model both during refresh and after a transport deadline', async () => {
  const persistence = storage();
  const request = fetcher();
  const reader = controller(persistence, request as typeof fetch);
  await reader.save();
  vi.useFakeTimers();
  request.mockImplementation(() => new Promise<Response>(() => {}));
  const saving = reader.save();
  expect(reader.getSnapshot().bundle?.snapshot.diary).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2001);
  await saving;
  expect(reader.getSnapshot().status).toBe('offline');
  expect(reader.getSnapshot().bundle?.snapshot.diary).toHaveLength(1);
  expect(purgeOfflineDevice).not.toHaveBeenCalled();
});
it('failed network verification reads the guarded local copy; background failure stays offline', async () => {
  const persistence = storage();
  const initial = controller(persistence, fetcher() as typeof fetch);
  await initial.save();
  const reader = controller(persistence, (async () => {
    throw new TypeError('network');
  }) as typeof fetch);
  await reader.activate(true);
  expect(reader.getSnapshot().bundle).not.toBeNull();
  expect(reader.getSnapshot().status).toBe('offline');
  expect(purgeOfflineDevice).not.toHaveBeenCalled();
  expect((await persistence.read()).bundle).not.toBeNull();
  const background = controller(
    persistence,
    (async (url: string) => {
      if (url === '/api/offline/identity') return identity();
      throw new TypeError('network');
    }) as typeof fetch,
    () => now + 300001,
  );
  await background.activate(true);
  expect(background.getSnapshot()).toMatchObject({
    enabled: true,
    status: 'offline',
    error: null,
  });
  expect(background.getSnapshot().bundle?.weightPolicyVersion).toBe(
    ownerConfirmedYazioWeightPolicyVersion,
  );
});

it('ready same-calendar clock rollback bypasses fast path and clears the guarded copy', async () => {
  const persistence = storage();
  let clock = now;
  const reader = controller(
    persistence,
    fetcher() as typeof fetch,
    () => clock,
  );
  await reader.save();
  expect(reader.getSnapshot().status).toBe('ready');
  persistence.read.mockClear();
  clock = now - 1;
  await reader.activate(true);
  expect(persistence.read).toHaveBeenCalledWith(clock, 'UTC');
  expect(reader.getSnapshot().bundle).toBeNull();
  expect((await persistence.metadata()).enabled).toBe(false);
  await reader.activate(true);
  expect(reader.getSnapshot().bundle).toBeNull();
  expect(persistence.read).toHaveBeenCalledTimes(3);
});
it('online identity denial supersedes a deferred unverified offline read without any private publish', async () => {
  const persistence = storage();
  await controller(persistence, fetcher() as typeof fetch).save();
  const staleCopy = await persistence.read();
  let release!: (value: typeof staleCopy) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  persistence.read.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  vi.mocked(purgeOfflineDevice).mockImplementationOnce(async () => {
    await persistence.purge();
  });
  const request = vi.fn(async () => new Response('{}', { status: 401 }));
  const reader = controller(persistence, request as typeof fetch);
  const privatePublishes: OfflineSnapshot[] = [];
  reader.subscribe(() => {
    const bundle = reader.getSnapshot().bundle;
    if (bundle) privatePublishes.push(bundle.snapshot);
  });
  const offline = reader.activate(false);
  await started;
  await reader.activate(true, true);
  expect(request).toHaveBeenCalledOnce();
  expect(purgeOfflineDevice).toHaveBeenCalledOnce();
  expect((await persistence.metadata()).enabled).toBe(false);
  release(staleCopy);
  await offline;
  expect(privatePublishes).toEqual([]);
  expect(reader.getSnapshot()).toMatchObject({
    bundle: null,
    photos: [],
    enabled: false,
    error: 'denied',
  });
  expect((await persistence.read()).bundle).toBeNull();
});

it('explicit file save keeps actual bytes and removing a copy does not invent an offline network state', async () => {
  vi.stubGlobal('location', { origin: 'https://tempo.example.test' });
  const persistence = storage();
  const copy = '%PDF-local';
  const request = vi.fn(async (url: string) => {
    if (url.startsWith('/api/reports?'))
      return new Response(copy, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(copy.length),
        },
      });
    return url === '/api/offline/identity'
      ? identity()
      : new Response(JSON.stringify(fixture));
  });
  const reader = controller(persistence, request as typeof fetch);
  await reader.save();
  await reader.saveFile({
    id: 'report:today',
    label: 'Today',
    kind: 'pdf',
    href: '/api/reports?format=pdf',
  });
  expect(await reader.getSnapshot().files[0]!.bytes.text()).toBe(copy);
  expect(reader.getSnapshot().status).toBe('ready');
  await reader.removeFile('report:today');
  expect(reader.getSnapshot().files).toEqual([]);
  expect(reader.getSnapshot().status).toBe('ready');
  expect(reader.getSnapshot().bundle).not.toBeNull();
  await expect(
    reader.saveFile({
      id: 'bad',
      label: 'Bad',
      kind: 'video',
      href: 'https://cdn.test/video?token=secret',
    }),
  ).rejects.toThrow();
});
it('a quota rejection during explicit file save preserves the copied diary', async () => {
  vi.stubGlobal('location', { origin: 'https://tempo.example.test' });
  const persistence = storage();
  persistence.writeFile.mockRejectedValueOnce(new Error('Quota exceeded'));
  const request = vi.fn(async (url: string) =>
    url.startsWith('/api/reports?')
      ? new Response('%PDF-local', {
          headers: { 'Content-Type': 'application/pdf' },
        })
      : url === '/api/offline/identity'
        ? identity()
        : new Response(JSON.stringify(fixture)),
  );
  const reader = controller(persistence, request as typeof fetch);
  await reader.save();
  await expect(
    reader.saveFile({
      id: 'report:today',
      label: 'Today',
      kind: 'pdf',
      href: '/api/reports?format=pdf',
    }),
  ).rejects.toThrow();
  expect(reader.getSnapshot().status).toBe('ready');
  expect(reader.getSnapshot().bundle?.snapshot.diary).toHaveLength(1);
});

it('checks file size with HEAD without persisting a file or downloading its body', async () => {
  vi.stubGlobal('location', { origin: 'https://tempo.test' });
  const persistence = storage();
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/reports')) expect(options?.method).toBe('HEAD');
    return url === '/api/offline/identity'
      ? identity()
      : url.startsWith('/api/offline/snapshot')
        ? new Response(JSON.stringify(fixture))
        : new Response(null, {
            headers: {
              'content-length': '1234',
              'content-type': 'application/pdf',
            },
          });
  });
  const reader = controller(persistence, requests as typeof fetch);
  await reader.save();
  expect(await reader.fileSize('/api/reports?format=pdf')).toBe(1234);
  expect(
    requests.mock.calls.find((call) => call[0].startsWith('/api/reports'))?.[1]
      ?.method,
  ).toBe('HEAD');
  expect(persistence.writeFile).not.toHaveBeenCalled();
  expect(reader.getSnapshot().bundle).not.toBeNull();
});
