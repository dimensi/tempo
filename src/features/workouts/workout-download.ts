import { z } from 'zod';
import { browserStore } from '@/lib/browser-storage';
import {
  canonicalReadKey,
  refreshClientRead,
  retainClientRead,
} from '@/lib/client-read';
import { readResources, type ReadDescriptor } from '@/lib/read-descriptors';
import { OfflineStorage } from '@/lib/offline-device';
import { savedFiles } from '@/lib/saved-files';
import { readSession, sessionGeneration } from '@/lib/session-state';
import { exerciseHref, techniqueHref } from './transformmate-exercises';

const downloadSchema = z.object({
  partition: z.string(),
  signature: z.string(),
  resources: z.array(z.string()),
  files: z.array(z.string()),
  missing: z.array(z.string()),
  savedAt: z.number(),
});
export type WorkoutDownload = z.infer<typeof downloadSchema>;
const storageKey = (key: string) => `workout-download:${key}`;

export async function readWorkoutDownload(key: string, signature: string) {
  const partition = readSession()?.partition;
  const generation = sessionGeneration();
  if (!partition) return null;
  const record = await browserStore<WorkoutDownload | null>(
    ['metadata', 'resources'],
    'readonly',
    (tx, done) => {
      const request = tx.objectStore('metadata').get(storageKey(key));
      request.onsuccess = () => {
        const parsed = downloadSchema.safeParse(request.result);
        if (
          !parsed.success ||
          parsed.data.partition !== partition ||
          parsed.data.signature !== signature
        )
          return done(null);
        const value = parsed.data;
        let pending = value.resources.length;
        let valid = true;
        for (const resource of value.resources) {
          const read = tx
            .objectStore('resources')
            .get(`${partition}:${resource}`);
          read.onsuccess = () => {
            if (!read.result) valid = false;
            if (--pending === 0) done(valid ? value : null);
          };
        }
        if (!pending) done(null);
      };
    },
  );
  if (!record || generation !== sessionGeneration()) return null;
  const files = await new OfflineStorage().files(partition);
  return generation === sessionGeneration() &&
    record.files.every((id) => files.some((file) => file.id === id))
    ? record
    : null;
}

export async function downloadWorkout(input: {
  key: string;
  signature: string;
  ownerId: string;
  resources: Pick<ReadDescriptor<unknown>, 'href'>[];
  exercises: { id: number; name: string }[];
  signal: AbortSignal;
  onProgress: (completed: number, total: number, name: string) => void;
}) {
  const partition = readSession()?.partition;
  const generation = sessionGeneration();
  const current = () =>
    !input.signal.aborted &&
    generation === sessionGeneration() &&
    partition === readSession()?.partition;
  const assertCurrent = () => {
    if (!partition || !current()) throw new Error('Download interrupted');
  };
  assertCurrent();
  const record: WorkoutDownload = {
    partition: partition!,
    signature: input.signature,
    resources: [],
    files: [],
    missing: [],
    savedAt: Date.now(),
  };
  for (const resource of input.resources) {
    const saved = await retainClientRead(resource);
    assertCurrent();
    record.resources.push(saved.key);
  }
  await savedFiles.load();
  const unique = [
    ...new Map(input.exercises.map((item) => [item.id, item])).values(),
  ];
  let completed = 0;
  for (const exercise of unique) {
    assertCurrent();
    input.onProgress(completed, unique.length, exercise.name);
    const resource = readResources.exercise(
      exerciseHref(input.ownerId, exercise.id),
    );
    const body = await refreshClientRead(
      canonicalReadKey(new URL(resource.href!, location.origin)),
    );
    assertCurrent();
    const info = resource.decode(body);
    if (info.id !== exercise.id) throw new Error('Exercise unavailable');
    const saved = await retainClientRead(resource);
    record.resources.push(saved.key);
    if (info.hasVideo) {
      const id = `exercise-video:${exercise.id}`;
      if (!savedFiles.getSnapshot().files.some((file) => file.id === id))
        await savedFiles.saveFile({
          id,
          label: info.name,
          kind: 'video',
          href: techniqueHref(input.ownerId, exercise.id),
          signal: input.signal,
        });
      assertCurrent();
      record.files.push(id);
    } else record.missing.push(exercise.name);
    input.onProgress(++completed, unique.length, exercise.name);
  }
  assertCurrent();
  await browserStore<void>(['metadata'], 'readwrite', (tx) => {
    if (!current()) {
      tx.abort();
      return;
    }
    const store = tx.objectStore('metadata');
    const request = store.getAllKeys();
    request.onsuccess = () => {
      if (!current()) {
        tx.abort();
        return;
      }
      const keys = request.result.filter(
        (key) =>
          String(key).startsWith('workout-download:') &&
          key !== storageKey(input.key),
      );
      for (const key of keys.slice(0, Math.max(0, keys.length - 29)))
        store.delete(key);
      store.put(record, storageKey(input.key));
    };
  });
  assertCurrent();
  return record;
}
