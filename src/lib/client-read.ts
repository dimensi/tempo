import {
  offlineReadBody,
  pruneReadRecords,
  readRecordSchema,
  readResponseSchema,
} from '@/contracts/read-resources';
import { apiFetch } from './api-client';
import { browserStore } from './browser-storage';
import { subscribeSessionReset } from './offline-device';
import {
  ReadFailure,
  ReadResourceStore,
  type PersistedRead,
} from './read-resource';
import type { ReadDescriptor } from './read-descriptors';
import { readSession, sessionGeneration } from './session-state';
export function canonicalReadKey(url: URL) {
  const params = new URLSearchParams(url.search);
  params.sort();
  return url.pathname + (params.size ? `?${params}` : '');
}
let scope = '';
export function bindReadScope() {
  const next = readSession()?.partition ?? '';
  if (scope !== next) {
    scope = next;
    clientReads.clear();
  }
}
const persistence = {
  async read(key: string): Promise<PersistedRead<string> | undefined> {
    const partition = readSession()?.partition;
    if (!partition) return;
    return browserStore(['resources'], 'readonly', (tx, done) => {
      const request = tx.objectStore('resources').get(`${partition}:${key}`);
      request.onsuccess = () => {
        const row = readRecordSchema.safeParse(request.result?.record);
        try {
          if (
            row.success &&
            readResponseSchema(
              new URL(key, 'https://tempo.local').pathname,
            )?.safeParse(JSON.parse(row.data.body)).success
          )
            return done({
              data: row.data.body,
              savedAt: row.data.savedAt,
              touchedAt: Date.now(),
              coverage: row.data.coverage,
            });
        } catch {
          /* A corrupt record is a cache miss. */
        }
        done(undefined);
      };
    });
  },
  async write(key: string, value: PersistedRead<string>) {
    const partition = readSession()?.partition;
    const generation = sessionGeneration();
    if (!partition) return;
    const body = offlineReadBody(key, value.data);
    if (!body) return;
    await browserStore<void>(['resources'], 'readwrite', (tx) => {
      const store = tx.objectStore('resources');
      const request = store.getAll();
      request.onsuccess = () => {
        if (generation !== sessionGeneration()) {
          tx.abort();
          return;
        }
        const rows = request.result.flatMap((value) => {
          const parsed = readRecordSchema.safeParse(value.record);
          return parsed.success &&
            value.account === partition &&
            parsed.data.key !== key
            ? [parsed.data]
            : [];
        });
        const record = {
          version: 2 as const,
          key,
          body,
          savedAt: value.savedAt,
          touchedAt: value.touchedAt,
          coverage: value.coverage ?? ('complete' as const),
        };
        const retained = pruneReadRecords([record, ...rows], Date.now()).slice(
          0,
          200,
        );
        store.clear();
        for (const row of retained)
          store.put(
            { record: row, account: partition },
            `${partition}:${row.key}`,
          );
      };
    });
  },
  async remove(key: string) {
    const partition = readSession()?.partition;
    if (partition)
      await browserStore<void>(['resources'], 'readwrite', (tx) => {
        tx.objectStore('resources').delete(`${partition}:${key}`);
      });
  },
};
function resourceCoverage(body: string, key: string): 'complete' | 'partial' {
  if (
    new URL(key, 'https://tempo.local').pathname ===
    '/api/workouts/transformmate/exercises'
  ) {
    const value = JSON.parse(body);
    if (
      value.catalog?.coverage !== 'complete' ||
      value.catalog?.hasMore ||
      Number(new URL(key, 'https://tempo.local').searchParams.get('offset')) > 0
    )
      return 'partial';
  }
  return 'complete';
}
export const clientReads = new ReadResourceStore<string>(
  persistence,
  Date.now,
  {
    entries: 200,
    weight: 14 * 1024 * 1024,
    size: (value) => new TextEncoder().encode(value).length,
  },
  resourceCoverage,
);
export const readRevalidateEvent = 'tempo:read-revalidate';
export function revalidateVisibleReads() {
  window.dispatchEvent(new Event(readRevalidateEvent));
}
export async function seedClientRead(
  key: string,
  value: unknown,
  expectedGeneration = sessionGeneration(),
  coverage?: 'complete' | 'partial',
) {
  key = canonicalReadKey(new URL(key, 'https://tempo.local'));
  if (expectedGeneration !== sessionGeneration() || !readSession()) return;
  bindReadScope();
  const schema = readResponseSchema(
    new URL(key, 'https://tempo.local').pathname,
  );
  if (!schema) return;
  const data = JSON.stringify(schema.parse(value));
  const savedAt = Date.now();
  const savedCoverage = coverage ?? resourceCoverage(data, key);
  clientReads.seed(key, data, savedAt, 'network', savedCoverage);
  await persistence
    .write(key, {
      data,
      savedAt,
      touchedAt: savedAt,
      coverage: savedCoverage,
    })
    .catch(() => {});
}
/** Apply a local mutation to the latest shared snapshot, never a render capture. */
export async function updateClientRead<T>(
  resource: ReadDescriptor<T>,
  update: (current: T | undefined) => T,
  expectedGeneration = sessionGeneration(),
) {
  if (
    !resource.href ||
    !readSession() ||
    expectedGeneration !== sessionGeneration()
  )
    return;
  bindReadScope();
  const key = canonicalReadKey(new URL(resource.href, 'https://tempo.local'));
  await clientReads.restore(key);
  if (expectedGeneration !== sessionGeneration()) return;
  const state = clientReads.snapshot(key);
  const current =
    state.data === undefined ? undefined : resource.decode(state.data);
  await seedClientRead(
    key,
    update(current),
    expectedGeneration,
    state.coverage === 'complete' ? 'complete' : 'partial',
  );
}
export async function refreshClientRead(key: string) {
  bindReadScope();
  const generation = sessionGeneration();
  return clientReads.read(
    key,
    navigator.onLine
      ? async () => {
          const response = await apiFetch(key, {
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          });
          if (generation !== sessionGeneration())
            throw new ReadFailure('denied');
          if (!response.ok)
            throw new ReadFailure(
              response.status === 403
                ? 'denied'
                : response.status === 404
                  ? 'not-found'
                  : 'unavailable',
              response.status,
            );
          const schema = readResponseSchema(
            new URL(key, 'https://tempo.local').pathname,
          );
          if (!schema) throw new ReadFailure('unavailable');
          return JSON.stringify(schema.parse(await response.json()));
        }
      : undefined,
  );
}
/** Explicit downloads must confirm disk persistence, unlike best-effort live reads. */
export async function retainClientRead(
  resource: Pick<ReadDescriptor<unknown>, 'href'>,
) {
  if (!resource.href) throw new Error('Resource unavailable');
  const generation = sessionGeneration();
  const key = canonicalReadKey(new URL(resource.href, 'https://tempo.local'));
  await clientReads.restore(key);
  const state = clientReads.snapshot(key);
  if (state.data === undefined || generation !== sessionGeneration())
    throw new Error('Resource unavailable');
  await persistence.write(key, {
    data: state.data,
    savedAt: state.savedAt ?? Date.now(),
    touchedAt: Date.now(),
    coverage: state.coverage === 'partial' ? 'partial' : 'complete',
  });
  const saved = await persistence.read(key);
  if (saved?.data !== state.data || generation !== sessionGeneration())
    throw new Error('Storage unavailable');
  return { key, body: state.data };
}
export function observeReadResources() {
  return subscribeSessionReset(() => {
    scope = '';
    clientReads.clear();
  });
}
export async function invalidateMedicalDocument(
  documentId: string,
  ownerId: string,
) {
  for (const key of [
    `/api/anamnesis/documents/${documentId}`,
    `/api/anamnesis/documents/${documentId}/observations`,
    '/api/anamnesis/documents',
  ])
    await clientReads.invalidate(
      `${key}?ownerId=${encodeURIComponent(ownerId)}`,
    );
  revalidateVisibleReads();
}
