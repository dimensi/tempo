import { medicalDocumentSchema } from '@/contracts/anamnesis';
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
) {
  if (expectedGeneration !== sessionGeneration() || !readSession()) return;
  bindReadScope();
  const schema = readResponseSchema(
    new URL(key, 'https://tempo.local').pathname,
  );
  if (!schema) return;
  const data = JSON.stringify(schema.parse(value));
  clientReads.seed(key, data);
  await persistence
    .write(key, {
      data,
      savedAt: Date.now(),
      touchedAt: Date.now(),
      coverage: resourceCoverage(data, key),
    })
    .catch(() => {});
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
            throw new ReadFailure('unavailable', response.status);
          const schema = readResponseSchema(
            new URL(key, 'https://tempo.local').pathname,
          );
          if (!schema) throw new ReadFailure('unavailable');
          return JSON.stringify(schema.parse(await response.json()));
        }
      : undefined,
  );
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
export async function savedMedicalDocument(
  documentId: string,
  ownerId: string,
) {
  const key = `/api/anamnesis/documents/${encodeURIComponent(documentId)}?ownerId=${encodeURIComponent(ownerId)}`;
  bindReadScope();
  await clientReads.restore(key);
  const body = clientReads.snapshot(key).data;
  if (!body) throw new ReadFailure('unavailable');
  return medicalDocumentSchema.parse(JSON.parse(body));
}
