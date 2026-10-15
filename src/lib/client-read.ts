import { offlineAnamnesisSchema } from '@/contracts/offline-anamnesis';
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
let fence: CacheFence | undefined;
const persistence = {
  async read(key: string): Promise<PersistedRead<string> | undefined> {
    if (!fence) return;
    const storage = new OfflineStorage();
    try {
      const row = (await storage.readResources(fence)).find(
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
        .writeResource(fence, { ...row, touchedAt: Date.now() })
        .catch(() => {});
      return { data, savedAt: row.savedAt, touchedAt: Date.now() };
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
          version: 1,
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
export function canonicalReadKey(url: URL) {
  const search = new URLSearchParams(url.search);
  search.sort();
  return url.pathname + (search.size ? `?${search}` : '');
}
function bindScope() {
  const bundle = getOfflineController().getSnapshot().bundle;
  const next = bundle
    ? `${bundle.fence.partition}:${bundle.fence.deviceEpoch}:${bundle.snapshot.connectionGeneration}`
    : '';
  if (scope !== next) {
    clientReads.clear();
    scope = next;
  }
  fence = bundle?.fence;
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
  bindScope();
  const latest = getOfflineController().getSnapshot().bundle?.snapshot;
  if (
    expected &&
    (latest?.partition !== expected.partition ||
      latest.connectionGeneration !== expected.connectionGeneration)
  )
    return;
  const schema = readResponseSchema(new URL(key, location.origin).pathname);
  if (!schema || !fence) return;
  const data = JSON.stringify(schema.parse(body));
  const savedAt = Date.now();
  clientReads.seed(key, data, savedAt);
  await persistence
    .write(key, { data, savedAt, touchedAt: savedAt })
    .catch(() => {});
}
export function observeReadResources() {
  const original = window.fetch;
  const stopScope = getOfflineController().subscribe(bindScope);
  bindScope();
  const stopBlocked = subscribeOfflineBlocked(() => {
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
    if (!schema) return original.call(window, input, init);
    bindScope();
    if (!fence) return original.call(window, input, init);
    const key = canonicalReadKey(url);
    let live: Response | undefined;
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const body = await clientReads.read(
        key,
        navigator.onLine
          ? async () => {
              // A caller's abort must not cancel a request shared with another reader.
              live = await original.call(window, input, {
                ...init,
                signal: AbortSignal.timeout(15000),
              });
              if (!live.ok)
                throw new ReadFailure(
                  live.status === 401 || live.status === 403
                    ? 'denied'
                    : 'unavailable',
                  live.status,
                );
              const parsed = schema.safeParse(await live.clone().json());
              if (!parsed.success) throw new ReadFailure('unavailable');
              return JSON.stringify(parsed.data);
            }
          : undefined,
      );
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (live?.ok) return live;
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
      if (live) return live;
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
        clientReads.snapshot(`/api/anamnesis/${name}?${query}`).source !==
        'network'
      )
        await seedClientRead(`/api/anamnesis/${name}?${query}`, value, current);
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
  bindScope();
  const body = await clientReads.read('/api/offline/anamnesis-local');
  return offlineAnamnesisSchema.parse(JSON.parse(body));
}
