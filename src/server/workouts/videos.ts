import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { workoutSessions } from '@/server/db/schema/workouts';
import { workoutVideos } from '@/server/db/schema/workout-videos';
import { getObjectStorage } from '@/server/storage';
import {
  videoCreateSchema,
  VIDEO_PART_BYTES,
  type WorkoutVideo,
} from '@/contracts/workout-videos';
import { WorkoutAccessError, WorkoutError } from './index';
import { validateWorkoutVideo } from './video-validation';
import { videoRange } from './video-range';
import { checkWorkoutOrigin, readWorkoutJson } from './http';

const locks = new Map<string, Promise<unknown>>();
async function serialize<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  locks.set(id, task);
  try {
    return await task;
  } finally {
    if (locks.get(id) === task) locks.delete(id);
  }
}
/** Shared by parent mutations and every video write; the app supports one Node process. */
export function withSessionVideoLock<T>(
  ownerId: string,
  sessionId: string,
  action: () => Promise<T>,
) {
  return serialize(`session:${ownerId}:${sessionId}`, action);
}
async function serializeVideoWrite<T>(
  request: Request,
  id: string,
  action: () => Promise<T>,
) {
  const row = await rowFor(request, id, true);
  return withSessionVideoLock(row.ownerId, row.sessionId, () =>
    serialize(id, action),
  );
}
type Row = typeof workoutVideos.$inferSelect;
const key = (row: Row, part?: number) =>
  `workout-videos/${row.id}/${part === undefined ? 'video.mp4' : `part-${part}`}`;
const dto = (row: Row): WorkoutVideo => ({
  ...row,
  parts: Object.keys(row.parts).map(Number),
});
async function access(request: Request, write: boolean) {
  if (write) checkWorkoutOrigin(request);
  const ownerId = new URL(request.url).searchParams.get('ownerId') ?? '';
  const result = await authorize(
    request.headers,
    write ? 'workouts:log' : 'workouts:read',
    ownerId,
  );
  if (!result.ok) throw new WorkoutAccessError(result.status);
  return ownerId;
}
function target(ownerId: string, sessionId: string, exerciseId?: string) {
  const session = getDatabase()
    .db.select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.ownerId, ownerId),
        eq(workoutSessions.id, sessionId),
      ),
    )
    .get();
  if (
    !session ||
    (exerciseId &&
      !session.data.exercises.some((exercise) => exercise.id === exerciseId))
  )
    throw new WorkoutError(404);
  return session;
}
async function rowFor(request: Request, id: string, write: boolean) {
  const ownerId = await access(request, write);
  const row = getDatabase()
    .db.select()
    .from(workoutVideos)
    .where(and(eq(workoutVideos.id, id), eq(workoutVideos.ownerId, ownerId)))
    .get();
  if (!row) throw new WorkoutError(404);
  target(ownerId, row.sessionId, row.exerciseId);
  return row;
}
export async function listVideos(request: Request) {
  const ownerId = await access(request, false);
  const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
  target(ownerId, sessionId);
  return getDatabase()
    .db.select()
    .from(workoutVideos)
    .where(
      and(
        eq(workoutVideos.ownerId, ownerId),
        eq(workoutVideos.sessionId, sessionId),
      ),
    )
    .all()
    .filter((row) => {
      const session = target(ownerId, sessionId);
      return session.data.exercises.some(
        (exercise) => exercise.id === row.exerciseId,
      );
    })
    .map(dto);
}
export async function createVideo(request: Request) {
  const ownerId = await access(request, true);
  const input = videoCreateSchema.parse(await readWorkoutJson(request));
  const requestId = request.headers.get('Idempotency-Key');
  const id = requestId === null ? randomUUID() : z.uuid().parse(requestId);
  return withSessionVideoLock(ownerId, input.sessionId, async () => {
    await access(request, true);
    const session = target(ownerId, input.sessionId, input.exerciseId);
    if (session.data.status !== 'completed') throw new WorkoutError(409);
    const existing = getDatabase()
      .db.select()
      .from(workoutVideos)
      .where(eq(workoutVideos.id, id))
      .get();
    if (existing) {
      if (
        existing.ownerId !== ownerId ||
        existing.sessionId !== input.sessionId ||
        existing.exerciseId !== input.exerciseId ||
        existing.size !== input.size ||
        existing.duration !== Math.ceil(input.duration)
      )
        throw new WorkoutError(409);
      return dto(existing);
    }
    const rows = getDatabase()
      .db.select()
      .from(workoutVideos)
      .where(eq(workoutVideos.ownerId, ownerId))
      .all();
    await cleanupVideoRows(
      rows.filter(
        (row) =>
          row.state === 'uploading' &&
          row.createdAt < Date.now() - 24 * 60 * 60 * 1000,
      ),
    );
    const currentRows = rows.filter(
      (row) =>
        row.state === 'ready' ||
        row.createdAt >= Date.now() - 24 * 60 * 60 * 1000,
    );
    // Bounded owner quota, including abandoned attempts; no unbounded private object growth.
    if (
      currentRows.filter((row) => row.state === 'uploading').length >= 10 ||
      currentRows.filter(
        (row) =>
          row.sessionId === input.sessionId &&
          row.exerciseId === input.exerciseId,
      ).length >= 8
    )
      throw new WorkoutError(409);
    return dto(
      getDatabase()
        .db.insert(workoutVideos)
        .values({
          ...input,
          id,
          ownerId,
          duration: Math.ceil(input.duration),
          state: 'uploading',
          parts: {},
          createdAt: Date.now(),
        })
        .returning()
        .get(),
    );
  });
}
export async function uploadVideoPart(
  request: Request,
  id: string,
  part: number,
) {
  return serializeVideoWrite(request, id, async () => {
    const row = await rowFor(request, id, true);
    const count = Math.ceil(row.size / VIDEO_PART_BYTES);
    if (
      row.state !== 'uploading' ||
      !Number.isInteger(part) ||
      part < 0 ||
      part >= count
    )
      throw new WorkoutError(409);
    const expected = Math.min(
      VIDEO_PART_BYTES,
      row.size - part * VIDEO_PART_BYTES,
    );
    const reader = request.body?.getReader();
    if (!reader) throw new SyntaxError();
    const bytes = new Uint8Array(expected);
    let offset = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.length > expected) {
          await reader.cancel();
          throw new SyntaxError();
        }
        bytes.set(chunk.value, offset);
        offset += chunk.value.length;
      }
    } finally {
      reader.releaseLock();
    }
    if (offset !== expected) throw new SyntaxError();
    await rowFor(request, id, true);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (row.parts[part] && row.parts[part] !== digest)
      throw new WorkoutError(409);
    if (!row.parts[part]) {
      await getObjectStorage().put(
        key(row, part),
        bytes,
        'application/octet-stream',
      );
      await rowFor(request, id, true);
      getDatabase()
        .db.update(workoutVideos)
        .set({ parts: { ...row.parts, [part]: digest } })
        .where(eq(workoutVideos.id, id))
        .run();
    }
    return dto(await rowFor(request, id, true));
  });
}
export async function finalizeVideo(request: Request, id: string) {
  return serializeVideoWrite(request, id, async () => {
    const row = await rowFor(request, id, true);
    if (row.state === 'ready') return dto(await cleanupReadyVideoParts(row));
    const count = Math.ceil(row.size / VIDEO_PART_BYTES);
    if (Object.keys(row.parts).length !== count) throw new WorkoutError(409);
    const storage = getObjectStorage();
    async function* chunks() {
      for (let part = 0; part < count; part++) {
        await rowFor(request, id, true);
        const bytes = await storage.get(key(row, part));
        if (
          createHash('sha256').update(bytes).digest('hex') !== row.parts[part]
        )
          throw new WorkoutError(409);
        yield bytes;
      }
    }
    const duration = await validateWorkoutVideo(row.size, async (part) => {
      await rowFor(request, id, true);
      return storage.get(key(row, part));
    });
    await storage.putStream(key(row), chunks(), row.size, 'video/mp4');
    try {
      await rowFor(request, id, true);
    } catch (error) {
      await storage.remove(key(row));
      throw error;
    }
    const saved = getDatabase()
      .db.update(workoutVideos)
      .set({ state: 'ready', duration })
      .where(eq(workoutVideos.id, id))
      .returning()
      .get();
    return dto(await cleanupReadyVideoParts(saved));
  });
}
/** Keep the complete part manifest until all idempotent removals succeed. */
async function cleanupReadyVideoParts(row: Row) {
  if (!Object.keys(row.parts).length) return row;
  for (const part of Object.keys(row.parts))
    await getObjectStorage().remove(key(row, Number(part)));
  return getDatabase()
    .db.update(workoutVideos)
    .set({ parts: {} })
    .where(eq(workoutVideos.id, row.id))
    .returning()
    .get();
}
export async function deleteVideo(request: Request, id: string) {
  return serializeVideoWrite(request, id, async () => {
    const row = await rowFor(request, id, true);
    const storage = getObjectStorage();
    await storage.remove(key(row));
    for (let part = 0; part < Math.ceil(row.size / VIDEO_PART_BYTES); part++)
      await storage.remove(key(row, part));
    getDatabase()
      .db.delete(workoutVideos)
      .where(eq(workoutVideos.id, id))
      .run();
    return null;
  });
}
export async function playbackVideo(request: Request, id: string) {
  const row = await rowFor(request, id, false);
  if (row.state !== 'ready') throw new WorkoutError(404);
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
  let range;
  try {
    range = videoRange(request.headers.get('range'), row.size);
  } catch {
    headers.set('Content-Range', `bytes */${row.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set(
    'Content-Length',
    String(range ? range.end - range.start + 1 : row.size),
  );
  if (range)
    headers.set(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${row.size}`,
    );
  if (request.method === 'HEAD')
    return new Response(null, { status: range ? 206 : 200, headers });
  const source = await getObjectStorage().readStream(
    key(row),
    range ?? undefined,
  );
  const reader = source.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await rowFor(request, id, false);
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        await reader.cancel();
        controller.error(error);
      }
    },
    cancel: () => reader.cancel(),
  });
  return new Response(body, { status: range ? 206 : 200, headers });
}

/** Internal cleanup; callers must authorize the parent workout before capturing rows. */
export function sessionVideoRows(ownerId: string, sessionId: string) {
  return getDatabase()
    .db.select()
    .from(workoutVideos)
    .where(
      and(
        eq(workoutVideos.ownerId, ownerId),
        eq(workoutVideos.sessionId, sessionId),
      ),
    )
    .all();
}
export async function cleanupVideoRows(rows: Row[]) {
  for (const row of rows)
    await serialize(row.id, async () => {
      const storage = getObjectStorage();
      await storage.remove(key(row));
      for (let part = 0; part < Math.ceil(row.size / VIDEO_PART_BYTES); part++)
        await storage.remove(key(row, part));
      getDatabase()
        .db.delete(workoutVideos)
        .where(
          and(
            eq(workoutVideos.id, row.id),
            eq(workoutVideos.ownerId, row.ownerId),
          ),
        )
        .run();
    });
}
