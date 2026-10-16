import { readContextSchema } from '@/contracts/read-context';
import { hasPendingLogout } from './local-logout';
import { offlineAnamnesisSchema } from '@/contracts/offline-anamnesis';
import {
  medicalDocumentSchema,
  type MedicalDocument,
} from '@/contracts/anamnesis';
import {
  ReadFailure,
  ReadResourceStore,
  type PersistedRead,
} from './read-resource';
import {
  isCacheableReadUrl,
  isMedicalDetail,
  offlineReadBody,
  readResponseSchema,
} from '@/contracts/read-resources';
import {
  OfflineStorage,
  subscribeOfflineBlocked,
  withOfflineCacheLock,
  type CacheFence,
} from './offline-device';
import { getOfflineController } from './offline-controller';
import { reportNetworkResult } from './network-state';

let scope = '';
let readBlocked = false;
let readTransport: typeof fetch = (...args) => fetch(...args);
let medicalRevision = 0;
let fence: CacheFence | undefined;
const persistence = {
  async read(key: string): Promise<PersistedRead<string> | undefined> {
    if (!fence) return;
    const expectedFence = fence;
    const storage = new OfflineStorage();
    try {
      const row = (await storage.readResources(expectedFence)).find(
        (row) => row.key === key,
      );
      if (!row) return;
      const schema = readResponseSchema(new URL(key, location.origin).pathname);
      if (!schema) return;
      const data = offlineReadBody(
        key,
        JSON.stringify(schema.parse(JSON.parse(row.body))),
      );
      if (data === undefined) return;
      await storage
        .writeResource(expectedFence, { ...row, touchedAt: Date.now() })
        .catch(() => {});
      return {
        data,
        savedAt: row.savedAt,
        touchedAt: Date.now(),
        coverage: data === row.body ? row.coverage : 'partial',
      };
    } finally {
      await storage.close();
    }
  },
  async remove(key: string) {
    if (!fence) return;
    const storage = new OfflineStorage();
    try {
      await storage.removeResource(fence, key);
    } finally {
      await storage.close();
    }
  },
  async write(key: string, value: PersistedRead<string>) {
    if (!fence) return;
    const body = offlineReadBody(key, value.data);
    if (
      body === undefined ||
      new TextEncoder().encode(body).length >
        (isMedicalDetail(key) ? 10 : 4) * 1024 * 1024
    )
      return;
    const storage = new OfflineStorage();
    try {
      const currentFence = fence;
      await withOfflineCacheLock(() =>
        storage.writeResource(currentFence, {
          version: 2,
          coverage:
            body === value.data ? (value.coverage ?? 'complete') : 'partial',
          key,
          body,
          savedAt: value.savedAt,
          touchedAt: value.touchedAt,
        }),
      );
    } finally {
      await storage.close();
    }
  },
};
export const clientReads = new ReadResourceStore<string>(
  persistence,
  Date.now,
  {
    entries: 200,
    weight: 14 * 1024 * 1024,
    size: (value) => new TextEncoder().encode(value).length,
  },
);
export async function invalidateMedicalDocument(
  documentId: string,
  ownerId: string,
) {
  bindReadScope();
  medicalRevision++;
  const query = `?${new URLSearchParams({ ownerId })}`;
  const base = `/api/anamnesis/documents/${encodeURIComponent(documentId)}`;
  const expected = getOfflineController().getSnapshot().bundle?.snapshot;
  const summary = await savedMedicalSummary().catch(() => undefined);
  await Promise.all(
    [
      base + query,
      base + '/observations' + query,
      '/api/anamnesis/documents' + query,
    ].map((key) => clientReads.invalidate(key)),
  );
  if (summary && summary.ownerId === ownerId && expected) {
    const documents = summary.documents.filter(
      (item) => item.id !== documentId,
    );
    await seedClientRead(
      '/api/offline/anamnesis-local',
      {
        ...summary,
        documents,
        complete: false,
        overview: {
          ...summary.overview,
          documents: Math.max(
            0,
            summary.overview.documents -
              (documents.length !== summary.documents.length ? 1 : 0),
          ),
          pendingDocumentId:
            summary.overview.pendingDocumentId === documentId
              ? null
              : summary.overview.pendingDocumentId,
          activeDocumentId:
            summary.overview.activeDocumentId === documentId
              ? null
              : summary.overview.activeDocumentId,
        },
      },
      expected,
    );
  }
  summaryVerified = '';
  await getOfflineController()
    .removeFile(`medical-document:${documentId}`)
    .catch(() => {});
  await prepareMedicalReads(true);
}
export function canonicalReadKey(url: URL) {
  const search = new URLSearchParams(url.search);
  search.sort();
  return url.pathname + (search.size ? `?${search}` : '');
}
export function bindReadScope() {
  const bundle = hasPendingLogout()
    ? null
    : getOfflineController().getSnapshot().bundle;
  const next = bundle
    ? `${bundle.fence.partition}:${bundle.fence.deviceEpoch}:${bundle.snapshot.connectionGeneration}`
    : '';
  if (scope !== next) {
    clientReads.clear();
    scope = next;
  }
  fence = bundle?.fence;
  if (fence) readBlocked = false;
}
export const readRevalidateEvent = 'tempo:read-revalidate';
/** Called only after current identity and the existing write queue have been checked. */
export function revalidateVisibleReads() {
  window.dispatchEvent(new Event(readRevalidateEvent));
}
export async function seedClientRead(
  key: string,
  body: unknown,
  expected?: { partition: string; connectionGeneration: string },
) {
  bindReadScope();
  const latest = getOfflineController().getSnapshot().bundle?.snapshot;
  if (
    expected &&
    (latest?.partition !== expected.partition ||
      latest.connectionGeneration !== expected.connectionGeneration)
  )
    return;
  const schema = readResponseSchema(new URL(key, location.origin).pathname);
  if (!schema || !fence) return;
  if (key === '/api/read/context') {
    const context = readContextSchema.parse(body);
    if (
      latest?.partition !== context.partition ||
      latest.connectionGeneration !== context.connectionGeneration
    )
      return;
  }
  const data = JSON.stringify(schema.parse(body));
  const savedAt = Date.now();
  clientReads.seed(key, data, savedAt);
  await persistence
    .write(key, { data, savedAt, touchedAt: savedAt })
    .catch(() => {});
}
export async function refreshClientRead(key: string) {
  bindReadScope();
  if (readBlocked && key !== '/api/read/context')
    throw new ReadFailure('denied');
  const schema = readResponseSchema(new URL(key, location.origin).pathname);
  if (!schema) throw new ReadFailure('unavailable');
  const body = await clientReads.read(
    key,
    navigator.onLine
      ? async () => {
          const response = await readTransport(key, {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              window.dispatchEvent(new Event('tempo:read-access-denied'));
              void import('./offline-device')
                .then(({ purgeOfflineDevice }) => purgeOfflineDevice())
                .catch(() => {});
            }
            throw new ReadFailure(
              response.status === 401 || response.status === 403
                ? 'denied'
                : 'unavailable',
              response.status,
            );
          }
          const data = schema.parse(await response.json());
          if (key === '/api/read/context') {
            const previous = clientReads.snapshot(key).data;
            const before =
              previous && readContextSchema.safeParse(JSON.parse(previous));
            const after = readContextSchema.parse(data);
            if (
              before &&
              before.success &&
              (before.data.partition !== after.partition ||
                before.data.connectionGeneration !==
                  after.connectionGeneration ||
                before.data.role !== after.role)
            ) {
              window.dispatchEvent(new Event('tempo:read-access-denied'));
              const { purgeOfflineDevice } = await import('./offline-device');
              await purgeOfflineDevice().catch(() => {});
              throw new ReadFailure('denied');
            }
          }
          return JSON.stringify(data);
        }
      : undefined,
  );
  // Only the current, schema-validated network context can authorize fresh
  // transports after a scope purge. Stale flights throw before reaching here.
  if (
    key === '/api/read/context' &&
    clientReads.snapshot(key).source === 'network'
  ) {
    const resumed = readBlocked;
    readBlocked = false;
    if (resumed) queueMicrotask(revalidateVisibleReads);
  }
  return body;
}
export function observeReadResources() {
  const original = window.fetch;
  readTransport = original.bind(window);
  const stopScope = getOfflineController().subscribe(bindReadScope);
  bindReadScope();
  const stopBlocked = subscribeOfflineBlocked(() => {
    readBlocked = true;
    clientReads.clear();
    scope = '';
    fence = undefined;
    summaryVerified = '';
  });
  const wrapped: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      location.origin,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const schema =
      url.origin === location.origin &&
      method === 'GET' &&
      isCacheableReadUrl(url)
        ? readResponseSchema(url.pathname)
        : undefined;
    if (
      url.origin === location.origin &&
      url.pathname.startsWith('/api/') &&
      !navigator.onLine &&
      !schema
    )
      throw new ReadFailure('network');
    if (!schema) {
      const response = await original.call(window, input, init);
      if (
        url.origin === location.origin &&
        method === 'GET' &&
        (url.pathname === '/api/reports' ||
          url.pathname.startsWith('/api/anamnesis/')) &&
        (response.status === 401 || response.status === 403)
      )
        denyReadAccess();
      return response;
    }
    bindReadScope();
    if (readBlocked) throw new ReadFailure('denied');
    if (!fence) return original.call(window, input, init);
    const key = canonicalReadKey(url);
    let live: Response | undefined;
    let validated = false;
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const body = await clientReads.read(
        key,
        navigator.onLine
          ? async () => {
              // A caller's abort must not cancel a request shared with another reader.
              try {
                live = await original.call(window, input, {
                  ...init,
                  signal: AbortSignal.timeout(15000),
                });
              } catch (error) {
                // This signal belongs to the shared transport, never to a caller.
                reportNetworkResult(false);
                throw error;
              }
              if (!live.ok) {
                if (live.status === 401 || live.status === 403)
                  denyReadAccess();
                throw new ReadFailure(
                  live.status === 401 || live.status === 403
                    ? 'denied'
                    : 'unavailable',
                  live.status,
                );
              }
              const parsed = schema.safeParse(await live.clone().json());
              if (!parsed.success) throw new ReadFailure('unavailable');
              validated = true;
              return JSON.stringify(parsed.data);
            }
          : undefined,
      );
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (live?.ok && validated) return live;
      const saved = offlineReadBody(key, body);
      if (saved === undefined) throw new ReadFailure('unavailable', 404);
      return new Response(saved, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Tempo-Read-Source': clientReads.snapshot(key).source ?? 'memory',
        },
      });
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error;
      if (error instanceof ReadFailure && error.reason === 'denied' && live?.ok)
        throw error;
      if (live && !live.ok) return live;
      if (live) throw error;
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        reportNetworkResult(false);
      throw error;
    }
  };
  window.fetch = wrapped;
  return () => {
    stopScope();
    stopBlocked();
    if (window.fetch === wrapped) window.fetch = original;
    clientReads.clear();
  };
}

let summaryFlight: Promise<void> | undefined;
let summaryVerified = '';
export function prepareMedicalReads(force = false) {
  if (summaryFlight) return summaryFlight;
  const state = getOfflineController().getSnapshot();
  if (state.status !== 'ready' || !state.bundle || !navigator.onLine)
    return Promise.resolve();
  const current = state.bundle.snapshot;
  const revision = medicalRevision;
  const key = `${current.partition}:${current.connectionGeneration}:${state.bundle.savedAt}`;
  if (!force && summaryVerified === key) return Promise.resolve();
  summaryFlight = (async () => {
    const response = await fetch('/api/offline/anamnesis', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (
      !payload ||
      payload.partition !== current.partition ||
      payload.connectionGeneration !== current.connectionGeneration
    )
      return;
    const data = offlineAnamnesisSchema.parse(payload.data);
    if (revision !== medicalRevision) return;
    const latest = getOfflineController().getSnapshot().bundle?.snapshot;
    if (
      latest?.partition !== current.partition ||
      latest.connectionGeneration !== current.connectionGeneration
    )
      return;
    const query = `ownerId=${encodeURIComponent(data.ownerId)}`;
    for (const [name, value] of [
      ['overview', data.overview],
      ['markers', data.markers],
      ['documents', data.documents],
      ['reports', data.reports],
    ] as const)
      if (
        revision === medicalRevision &&
        (force ||
          clientReads.snapshot(`/api/anamnesis/${name}?${query}`).source !==
            'network')
      )
        await seedClientRead(`/api/anamnesis/${name}?${query}`, value, current);
    if (revision !== medicalRevision) return;
    await seedClientRead('/api/offline/anamnesis-local', data, current);
    summaryVerified = key;
  })()
    .catch(() => {})
    .finally(() => {
      summaryFlight = undefined;
    });
  return summaryFlight;
}
export async function savedMedicalSummary() {
  bindReadScope();
  const body = await clientReads.read('/api/offline/anamnesis-local');
  return offlineAnamnesisSchema.parse(JSON.parse(body));
}

export async function savedMedicalDocument(
  documentId: string,
  ownerId: string,
): Promise<MedicalDocument> {
  bindReadScope();
  const key = canonicalReadKey(
    new URL(
      `/api/anamnesis/documents/${encodeURIComponent(documentId)}?ownerId=${encodeURIComponent(ownerId)}`,
      location.origin,
    ),
  );
  const body = await clientReads.read(key);
  return medicalDocumentSchema.parse(JSON.parse(body));
}

export async function hasSavedMedicalRoute(url: URL) {
  if (url.pathname !== '/anamnesis' && !url.pathname.startsWith('/anamnesis/'))
    return false;
  const summary = await savedMedicalSummary().catch(() => undefined);
  if (!summary) return false;
  if (url.pathname === '/anamnesis') return true;
  const match = url.pathname.match(
    /^\/anamnesis\/(markers|documents)\/([^/]+)$/,
  );
  if (!match) return false;
  const kind = match[1];
  const resourceId = match[2];
  if (!kind || !resourceId) return false;
  if (kind === 'documents')
    return savedMedicalDocument(resourceId, summary.ownerId).then(
      () => true,
      () => false,
    );
  const key = canonicalReadKey(
    new URL(
      `/api/anamnesis/${kind}/${resourceId}?ownerId=${encodeURIComponent(summary.ownerId)}`,
      location.origin,
    ),
  );
  const observationsKey = canonicalReadKey(
    new URL(
      `/api/anamnesis/markers/${resourceId}/observations?ownerId=${encodeURIComponent(summary.ownerId)}`,
      location.origin,
    ),
  );
  return Promise.all([
    clientReads.read(key),
    clientReads.read(observationsKey),
  ]).then(
    () => true,
    () => false,
  );
}

function denyReadAccess() {
  window.dispatchEvent(new Event('tempo:read-access-denied'));
  void import('./offline-device')
    .then(({ purgeOfflineDevice }) => purgeOfflineDevice())
    .catch(() => {});
}
