import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  partition: 'owner',
  generation: 'scope',
  online: true,
  disk: new Map<string, unknown>(),
  listeners: new Set<() => void>(),
  blocked: () => {},
}));
vi.mock('@/lib/offline-controller', () => ({
  getOfflineController: () => ({
    removeFile: vi.fn(async () => {}),
    getSnapshot: () => ({
      status: 'ready',
      bundle: {
        fence: {
          partition: state.partition,
          generation: 1,
          deviceEpoch: state.generation,
        },
        savedAt: 100,
        snapshot: {
          partition: state.partition,
          connectionGeneration: state.generation,
          role: 'OWNER',
        },
      },
    }),
    subscribe: (callback: () => void) => {
      state.listeners.add(callback);
      return () => state.listeners.delete(callback);
    },
  }),
}));
vi.mock('@/lib/offline-device', () => ({
  subscribeOfflineBlocked: (callback: () => void) => {
    state.blocked = callback;
    return () => {};
  },
  withOfflineCacheLock: async (action: () => Promise<unknown>) => {
    await action();
    return 'completed';
  },
  OfflineStorage: class {
    readResources(fence: { partition: string }) {
      return Promise.resolve(
        [...state.disk.entries()]
          .filter(([key]) => key.startsWith(fence.partition + ':'))
          .map(([, value]) => value),
      );
    }
    writeResource(fence: { partition: string }, record: { key: string }) {
      state.disk.set(fence.partition + ':' + record.key, record);
      return Promise.resolve();
    }
    removeResource(fence: { partition: string }, key: string) {
      state.disk.delete(fence.partition + ':' + key);
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  },
}));
vi.mock('@/lib/network-state', () => ({ reportNetworkResult: vi.fn() }));
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  state.disk.clear();
  state.listeners.clear();
  state.partition = 'owner';
  state.generation = 'scope';
  state.online = true;
  vi.stubGlobal('location', {
    origin: 'https://tempo.test',
    href: 'https://tempo.test/',
  });
  vi.stubGlobal('navigator', {
    get onLine() {
      return state.online;
    },
  });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function install(fetcher: typeof fetch) {
  vi.stubGlobal('window', { fetch: fetcher });
  const reader = await import('@/lib/client-read');
  cleanup = reader.observeReadResources();
  return reader;
}
const path = '/api/settings/steps-goal';
it('successful reads populate both tiers and transport failures transparently serve validated data', async () => {
  const raw = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ dailyStepsGoal: 7000 }))
    .mockRejectedValueOnce(new TypeError('offline'));
  const { clientReads } = await install(raw);
  expect(await (await window.fetch(path)).json()).toEqual({
    dailyStepsGoal: 7000,
  });
  expect(state.disk.size).toBe(1);
  const fallback = await window.fetch(path);
  expect(await fallback.json()).toEqual({ dailyStepsGoal: 7000 });
  expect(clientReads.snapshot(path)).toMatchObject({
    source: 'memory',
    error: 'network',
  });
  state.online = false;
  expect(await (await window.fetch(path)).json()).toEqual({
    dailyStepsGoal: 7000,
  });
  expect(raw).toHaveBeenCalledTimes(2);
});
it('one aborted caller does not cancel another reader of the same in-flight resource', async () => {
  const result = Promise.withResolvers<Response>();
  const raw = vi.fn<typeof fetch>(() => result.promise);
  await install(raw);
  const controller = new AbortController();
  const first = window.fetch(path, { signal: controller.signal });
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = window.fetch(path);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  result.resolve(Response.json({ dailyStepsGoal: 1234 }));
  await rejected;
  expect(await (await second).json()).toEqual({ dailyStepsGoal: 1234 });
  expect(raw).toHaveBeenCalledOnce();
});
it('late responses from another account cannot enter the current memory or disk scope', async () => {
  const result = Promise.withResolvers<Response>();
  const raw = vi.fn<typeof fetch>(() => result.promise);
  const { clientReads } = await install(raw);
  const first = window.fetch(path);
  const rejected = expect(first).rejects.toMatchObject({ reason: 'denied' });
  await Promise.resolve();
  await Promise.resolve();
  state.partition = 'other';
  for (const listener of state.listeners) listener();
  result.resolve(Response.json({ dailyStepsGoal: 1000 }));
  await rejected;
  expect(clientReads.snapshot(path).data).toBeUndefined();
  expect(state.disk.size).toBe(0);
});
it('confirmed access denial is returned as denial and never disguised as an offline copy', async () => {
  const raw = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ dailyStepsGoal: 1000 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  const { clientReads } = await install(raw);
  await window.fetch(path);
  expect((await window.fetch(path)).status).toBe(403);
  expect(clientReads.snapshot(path).data).toBeUndefined();
  expect(state.disk.size).toBe(0);
});
it('credentials and responses outside approved schemas are not persisted', async () => {
  const raw = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ dailyStepsGoal: 1000, token: 'synthetic-secret' }),
    );
  await install(raw);
  await expect(window.fetch(path)).rejects.toBeDefined();
  expect(state.disk.size).toBe(0);
  state.online = false;
  await expect(window.fetch(path)).rejects.toBeDefined();
});
it('an invalid successful payload serves validated saved data instead of the malformed live response', async () => {
  const raw = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ dailyStepsGoal: 1000 }))
    .mockResolvedValueOnce(Response.json({ dailyStepsGoal: 'invalid' }));
  await install(raw);
  await window.fetch(path);
  const response = await window.fetch(path);
  expect(await response.json()).toEqual({ dailyStepsGoal: 1000 });
  expect(response.headers.get('X-Tempo-Read-Source')).toBeTruthy();
});
it('a shared transport timeout reports unreachable even when cached data is returned', async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  const raw = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ dailyStepsGoal: 1000 }))
    .mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('timeout', 'AbortError')),
          );
        }),
    );
  await install(raw);
  const { reportNetworkResult } = await import('@/lib/network-state');
  vi.mocked(reportNetworkResult).mockClear();
  await window.fetch(path);
  const pending = window.fetch(path);
  await Promise.resolve();
  await Promise.resolve();
  timeout.abort();
  expect(await (await pending).json()).toEqual({ dailyStepsGoal: 1000 });
  expect(reportNetworkResult).toHaveBeenCalledWith(false);
});
it('document deletion removes both details and observations from memory and persistent storage', async () => {
  const { clientReads, invalidateMedicalDocument } = await install(vi.fn());
  for (const key of [
    '/api/anamnesis/documents/doc?ownerId=owner',
    '/api/anamnesis/documents/doc/observations?ownerId=owner',
  ]) {
    clientReads.seed(key, '{}');
    state.disk.set('owner:' + key, { key, body: '{}' });
  }
  await invalidateMedicalDocument('doc', 'owner');
  expect(state.disk.size).toBe(0);
  expect(
    clientReads.snapshot('/api/anamnesis/documents/doc?ownerId=owner').data,
  ).toBeUndefined();
  expect(
    clientReads.snapshot(
      '/api/anamnesis/documents/doc/observations?ownerId=owner',
    ).data,
  ).toBeUndefined();
});
it('document deletion preserves the medical workspace summary when its refresh fails', async () => {
  const {
    seedClientRead,
    savedMedicalSummary,
    hasSavedMedicalRoute,
    invalidateMedicalDocument,
  } = await install(
    vi.fn(async () => {
      throw new TypeError('offline');
    }),
  );
  const document = {
    id: '00000000-0000-4000-8000-000000000001',
    ownerId: '00000000-0000-4000-8000-000000000003',
    filename: 'lab.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    pageCount: 1,
    laboratoryName: null,
    title: null,
    collectedAt: null,
    issuedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
  await seedClientRead('/api/offline/anamnesis-local', {
    version: 1,
    ownerId: '00000000-0000-4000-8000-000000000003',
    complete: true,
    overview: {
      documents: 2,
      markers: 0,
      observations: 0,
      pendingReviews: 0,
      activeImports: 0,
      pendingDocumentId: null,
      activeDocumentId: null,
      lastCollectedAt: null,
    },
    markers: [],
    documents: [
      document,
      { ...document, id: '00000000-0000-4000-8000-000000000002' },
    ],
    reports: [],
  });
  expect(
    await hasSavedMedicalRoute(new URL('/anamnesis', 'https://tempo.test')),
  ).toBe(true);
  expect(
    await hasSavedMedicalRoute(
      new URL(
        '/anamnesis/documents/00000000-0000-4000-8000-000000000001',
        'https://tempo.test',
      ),
    ),
  ).toBe(false);
  await seedClientRead(
    '/api/anamnesis/documents/00000000-0000-4000-8000-000000000001?ownerId=00000000-0000-4000-8000-000000000003',
    document,
  );
  expect(
    await hasSavedMedicalRoute(
      new URL(
        '/anamnesis/documents/00000000-0000-4000-8000-000000000001',
        'https://tempo.test',
      ),
    ),
  ).toBe(true);
  const marker = {
    id: 'blood-glucose',
    code: 'GLU',
    name: 'Glucose',
    shortName: null,
    category: 'biochemistry',
    description: null,
    preferredUnit: null,
    definitionVersion: 1,
  };
  const markerPath = '/anamnesis/markers/blood-glucose';
  const markerApi =
    '/api/anamnesis/markers/blood-glucose?ownerId=00000000-0000-4000-8000-000000000003';
  await seedClientRead(markerApi, marker);
  expect(
    await hasSavedMedicalRoute(new URL(markerPath, 'https://tempo.test')),
  ).toBe(false);
  await seedClientRead(
    '/api/anamnesis/markers/blood-glucose/observations?ownerId=00000000-0000-4000-8000-000000000003',
    [],
  );
  expect(
    await hasSavedMedicalRoute(new URL(markerPath, 'https://tempo.test')),
  ).toBe(true);
  await invalidateMedicalDocument(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003',
  );
  const summary = await savedMedicalSummary();
  expect(summary.documents.map((item) => item.id)).toEqual([
    '00000000-0000-4000-8000-000000000002',
  ]);
  expect(summary.overview.documents).toBe(1);
  expect(summary.complete).toBe(false);
});
