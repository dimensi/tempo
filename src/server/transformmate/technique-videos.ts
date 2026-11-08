import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { exerciseTechniqueVideos as videos } from '@/server/db/schema/exercise-technique';
import { getDatabase } from '@/server/db';
import { getObjectStorage } from '@/server/storage';
import { VIDEO_PART_BYTES } from '@/contracts/workout-videos';
import { WorkoutError } from '@/server/workouts';
import {
  transcodeWorkoutVideo,
  VideoProcessingError,
} from '@/server/workouts/video-processing';
import {
  candidateStates,
  db,
  ownsTechnique,
  videoTarget,
  type TechniqueTarget,
  type TechniqueVideo,
} from './technique-store';
import { getTransformMateCatalogBindingFence } from './runtime';

const expiry = 24 * 60 * 60 * 1000;
const host = globalThis as typeof globalThis & {
  techniqueLocks?: Map<string, Promise<unknown>>;
  techniqueCleanup?: Promise<void>;
};
const locks = (host.techniqueLocks ??= new Map());
export async function withTechniqueLock<T>(
  target: TechniqueTarget,
  action: () => Promise<T>,
) {
  const key = JSON.stringify([
    target.ownerId,
    target.accountScope,
    target.exerciseId,
  ]);
  const task = (locks.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(action);
  locks.set(key, task);
  try {
    return await task;
  } finally {
    if (locks.get(key) === task) locks.delete(key);
  }
}

export const techniqueVideoKey = (id: string, part?: number) =>
  `workout-videos/technique/${id}/${part === undefined ? 'video.mp4' : `part-${part}`}`;
export const videoDigest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const techniquePartCount = (row: TechniqueVideo) =>
  Math.ceil(row.size / VIDEO_PART_BYTES);

export function retireTechniqueVideo(row: TechniqueVideo) {
  db()
    .update(videos)
    .set({ state: 'retired' })
    .where(eq(videos.id, row.id))
    .run();
}

export function kickTechniqueCleanup() {
  if (host.techniqueCleanup) return;
  host.techniqueCleanup = maintainTechniqueVideos()
    .catch(() => {})
    .finally(() => {
      host.techniqueCleanup = undefined;
    });
}

async function maintainTechniqueVideos() {
  const before = Date.now() - expiry;
  const stale = or(
    eq(videos.state, 'retired'),
    and(inArray(videos.state, candidateStates), lt(videos.createdAt, before)),
  );
  // Retain records and manifests until object removal succeeds.
  const cleanup = db()
    .select()
    .from(videos)
    .where(
      or(stale, and(eq(videos.state, 'ready'), sql`${videos.parts} <> '{}'`)),
    )
    .orderBy(asc(videos.createdAt))
    .limit(10)
    .all();
  for (const row of cleanup) {
    await withTechniqueLock(row, async () => {
      const current = db()
        .select()
        .from(videos)
        .where(eq(videos.id, row.id))
        .get();
      if (!current) return;
      const storage = getObjectStorage();
      if (current.state === 'ready') {
        for (const part of Object.keys(current.parts))
          await storage.remove(techniqueVideoKey(current.id, Number(part)));
        db()
          .update(videos)
          .set({ parts: {} })
          .where(eq(videos.id, current.id))
          .run();
      } else if (current.state === 'retired' || current.createdAt < before) {
        retireTechniqueVideo(current);
        await storage.remove(techniqueVideoKey(current.id));
        for (let part = 0; part < techniquePartCount(current); part++)
          await storage.remove(techniqueVideoKey(current.id, part));
        db().delete(videos).where(eq(videos.id, current.id)).run();
      }
    }).catch(() => {}); // The next worker pass retries storage outages.
  }
}

function canPublish(row: TechniqueVideo) {
  const actor = getDatabase()
    .sqlite.prepare(
      `SELECT 1 FROM user AS actor
     JOIN user AS owner ON owner.id = ? AND owner.role = 'OWNER'
     WHERE actor.id = ? AND (
       (actor.id = owner.id AND actor.role = 'OWNER') OR
       (actor.role = 'TRAINER' AND EXISTS (
         SELECT 1 FROM trainer_access WHERE trainer_id = actor.id AND owner_id = owner.id
       ))
     )`,
    )
    .get(row.ownerId, row.submittedBy);
  return Boolean(actor) && ownsTechnique(row);
}

export async function processNextTechniqueVideo() {
  const row = db()
    .select()
    .from(videos)
    .where(eq(videos.state, 'processing'))
    .orderBy(asc(videos.createdAt))
    .get();
  if (!row) return false;
  const predicate = and(eq(videos.id, row.id), eq(videos.state, 'processing'));
  const controller = new AbortController();
  const storage = getObjectStorage();
  let lastProgress = 0;
  try {
    const binding = await getTransformMateCatalogBindingFence(row.ownerId);
    const assertCurrent = () => {
      binding.assertBindingCurrent();
      if (
        binding.accountScope !== row.accountScope ||
        !canPublish(row) ||
        !db().select({ id: videos.id }).from(videos).where(predicate).get()
      )
        throw new WorkoutError(409);
    };
    assertCurrent();
    await transcodeWorkoutVideo(
      {
        size: row.size,
        signal: controller.signal,
        async readPart(part) {
          assertCurrent();
          const bytes = await storage.get(techniqueVideoKey(row.id, part));
          if (videoDigest(bytes) !== row.parts[part])
            throw new VideoProcessingError('invalid');
          return bytes;
        },
        progress(progress) {
          if (Date.now() - lastProgress < 500) return;
          lastProgress = Date.now();
          try {
            assertCurrent();
            db().update(videos).set({ progress }).where(predicate).run();
          } catch {
            controller.abort();
          }
        },
      },
      (output) =>
        withTechniqueLock(row, async () => {
          await binding.assertCurrent();
          assertCurrent();
          await storage.putStream(
            techniqueVideoKey(row.id),
            output.body,
            output.size,
            'video/mp4',
          );
          await binding.assertCurrent();
          assertCurrent();
          db().transaction((transaction) => {
            transaction
              .update(videos)
              .set({ state: 'retired' })
              .where(and(videoTarget(row), eq(videos.state, 'ready')))
              .run();
            transaction
              .update(videos)
              .set({
                state: 'ready',
                playbackSize: output.size,
                progress: 1,
              })
              .where(predicate)
              .run();
          });
        }),
    );
  } catch (error) {
    db()
      .update(videos)
      .set({
        state: 'failed',
        error:
          error instanceof VideoProcessingError ? error.code : 'processing',
      })
      .where(predicate)
      .run();
  }
  return true;
}
