import 'server-only';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import {
  exerciseTechniqueDescriptions as descriptions,
  exerciseTechniqueVideos as videos,
} from '@/server/db/schema/exercise-technique';
import { getObjectStorage } from '@/server/storage';
import { WorkoutAccessError, WorkoutError } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutResponse,
} from '@/server/workouts/http';
import { kickWorkoutVideoProcessing } from '@/server/workouts/videos';
import { readVideoPart, streamPrivateVideo } from '@/server/workouts/video-io';
import { VIDEO_PART_BYTES } from '@/contracts/workout-videos';
import {
  techniqueDescriptionInput,
  techniqueVideoInput,
} from '@/contracts/exercise-technique';
import { getTransformMateCatalogBindingFence } from './runtime';
import {
  db,
  descriptionTarget,
  ownsTechnique,
  techniqueCandidate,
  techniqueEditorData,
  techniqueScopeToken,
  videoTarget,
} from './technique-store';
import {
  retireTechniqueVideo,
  techniquePartCount,
  techniqueVideoKey,
  videoDigest,
  withTechniqueLock,
} from './technique-videos';

const exerciseIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const notFound = () => new WorkoutError(404);
const conflict = () => new WorkoutError(409);

async function accessTechnique(
  request: Request,
  exerciseId: number,
  write: boolean,
) {
  if (write) checkWorkoutOrigin(request);
  const ownerId = new URL(request.url).searchParams.get('ownerId') ?? '';
  const actor = async () => {
    const result = await authorize(
      request.headers,
      write ? 'workouts:plan' : 'workouts:read',
      ownerId,
    );
    if (!result.ok) throw new WorkoutAccessError(result.status);
    return result.session.user.id;
  };
  await actor();
  const binding = await getTransformMateCatalogBindingFence(ownerId);
  if (!binding.accountScope) throw notFound();
  const target = { ownerId, exerciseId, accountScope: binding.accountScope };
  const assertCurrent = async () => {
    await binding.assertCurrent();
    const actorId = await actor();
    binding.assertBindingCurrent();
    if (!ownsTechnique(target)) throw notFound();
    return actorId;
  };
  await assertCurrent();
  return { target, assertCurrent };
}

export async function exerciseTechniqueRequest(
  request: Request,
  rawId: string,
  path: string[],
) {
  const [collection, rawVideoId, action, rawPart, ...rest] = path;
  const method = request.method;
  const playback =
    collection === 'videos' &&
    action === 'playback' &&
    path.length === 3 &&
    (method === 'GET' || method === 'HEAD');
  const serve = async () => {
    const id = exerciseIdSchema.parse(rawId);
    const write = method !== 'GET' && method !== 'HEAD';
    const { target, assertCurrent } = await accessTechnique(request, id, write);
    const rowFor = (videoId: string) => {
      const row = db()
        .select()
        .from(videos)
        .where(
          and(
            videoTarget(target),
            eq(videos.id, videoId),
            ne(videos.state, 'retired'),
          ),
        )
        .get();
      if (!row) throw notFound();
      return row;
    };
    if (playback) {
      const videoId = z.uuid().parse(rawVideoId);
      const current = () => {
        const row = rowFor(videoId);
        if (row.state !== 'ready' || !row.playbackSize) throw notFound();
        return { size: row.playbackSize, key: techniqueVideoKey(row.id) };
      };
      const { size, key } = current();
      return streamPrivateVideo(request, key, size, async () => {
        await assertCurrent();
        current();
      });
    }
    if (!path.length && method === 'GET') return techniqueEditorData(target);
    if (!path.length && method === 'PATCH') {
      const input = techniqueDescriptionInput.parse(
        await readWorkoutJson(request),
      );
      await assertCurrent();
      if (input.scope !== techniqueScopeToken(target)) throw conflict();
      const description = input.description || null;
      const row = db()
        .select()
        .from(descriptions)
        .where(descriptionTarget(target))
        .get();
      if ((row?.revision ?? 0) !== input.revision) {
        // An identical retry of the immediately preceding write is safe.
        if (
          row?.revision === input.revision + 1 &&
          row.description === description
        )
          return techniqueEditorData(target);
        throw conflict();
      }
      db()
        .insert(descriptions)
        .values({ ...target, description, revision: input.revision + 1 })
        .onConflictDoUpdate({
          target: [
            descriptions.ownerId,
            descriptions.accountScope,
            descriptions.exerciseId,
          ],
          set: { description, revision: input.revision + 1 },
        })
        .run();
      return techniqueEditorData(target);
    }
    if (collection !== 'videos' || rest.length) throw notFound();
    if (path.length === 1 && method === 'POST') {
      const input = techniqueVideoInput.parse(await readWorkoutJson(request));
      const videoId = z.uuid().parse(request.headers.get('Idempotency-Key'));
      return withTechniqueLock(target, async () => {
        await assertCurrent();
        if (input.scope !== techniqueScopeToken(target)) throw conflict();
        const existing = db()
          .select()
          .from(videos)
          .where(eq(videos.id, videoId))
          .get();
        if (existing) {
          const scoped = rowFor(videoId);
          if (
            scoped.name !== input.name ||
            scoped.size !== input.size ||
            scoped.lastModified !== (input.lastModified ?? null)
          )
            throw conflict();
          return techniqueEditorData(target);
        }
        const pending = db()
          .select({ count: sql<number>`count(*)` })
          .from(videos)
          .where(
            and(eq(videos.ownerId, target.ownerId), ne(videos.state, 'ready')),
          )
          .get();
        if (techniqueCandidate(target) || (pending?.count ?? 0) >= 10)
          throw conflict();
        db()
          .insert(videos)
          .values({
            ...target,
            id: videoId,
            name: input.name,
            size: input.size,
            lastModified: input.lastModified,
            parts: {},
            state: 'uploading',
            createdAt: Date.now(),
          })
          .run();
        return techniqueEditorData(target);
      });
    }
    const videoId = z.uuid().parse(rawVideoId);
    return withTechniqueLock(target, async () => {
      const actorId = await assertCurrent();
      const row = rowFor(videoId);
      if (method === 'PUT' && path.length === 4 && action === 'parts') {
        const part = z.coerce.number().int().nonnegative().parse(rawPart);
        if (row.state !== 'uploading' || part >= techniquePartCount(row))
          throw conflict();
        const bytes = await readVideoPart(
          request,
          Math.min(VIDEO_PART_BYTES, row.size - part * VIDEO_PART_BYTES),
        );
        await assertCurrent();
        const digest = videoDigest(bytes);
        if (row.parts[part] && row.parts[part] !== digest) throw conflict();
        if (!row.parts[part]) {
          await getObjectStorage().put(
            techniqueVideoKey(row.id, part),
            bytes,
            'application/octet-stream',
          );
          await assertCurrent();
          db()
            .update(videos)
            .set({ parts: { ...row.parts, [part]: digest } })
            .where(eq(videos.id, row.id))
            .run();
        }
      } else if (
        method === 'POST' &&
        path.length === 3 &&
        action === 'finalize'
      ) {
        if (row.state === 'uploading' || row.state === 'failed') {
          if (
            Object.keys(row.parts).length !== techniquePartCount(row) ||
            row.error === 'invalid'
          )
            throw conflict();
          db()
            .update(videos)
            .set({
              state: 'processing',
              progress: 0,
              error: null,
              submittedBy: actorId,
            })
            .where(eq(videos.id, row.id))
            .run();
        }
        kickWorkoutVideoProcessing();
      } else if (method === 'DELETE' && path.length === 2) {
        const slot = new URL(request.url).searchParams.get('slot');
        if (slot !== (row.state === 'ready' ? 'ready' : 'candidate'))
          throw conflict();
        if (slot === 'ready' && techniqueCandidate(target)) throw conflict();
        retireTechniqueVideo(row);
        kickWorkoutVideoProcessing();
      } else {
        throw notFound();
      }
      return techniqueEditorData(target);
    });
  };
  if (playback) {
    try {
      return (await serve()) as Response;
    } catch (error) {
      return workoutResponse(() => Promise.reject(error));
    }
  }
  return workoutResponse(serve);
}
