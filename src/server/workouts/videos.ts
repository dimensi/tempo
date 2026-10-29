import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq, asc, ne, lt } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { workouts } from '@/server/db/schema/workouts';
import { workoutVideos } from '@/server/db/schema/workout-videos';
import { getObjectStorage } from '@/server/storage';
import {
  videoCreateSchema,
  VIDEO_PART_BYTES,
  type WorkoutVideo,
} from '@/contracts/workout-videos';
import { WorkoutAccessError, WorkoutError } from './index';
import {
  transcodeWorkoutVideo,
  VideoProcessingError,
  workoutVideoTemporaryRoot,
} from './video-processing';
import { videoRange } from './video-range';
import { checkWorkoutOrigin, readWorkoutJson } from './http';

// Instrumentation and route handlers can be emitted as separate module factories.
// Their queue, cancellation and parent-write locks must still share one process state.
const host = globalThis as unknown as {
  workoutVideoRuntime?: {
    locks: Map<string, Promise<unknown>>;
    controllers: Map<string, AbortController>;
    processing?: Promise<void>;
    initialized: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
};
const runtime: NonNullable<typeof host.workoutVideoRuntime> =
  (host.workoutVideoRuntime ??= {
    locks: new Map(),
    controllers: new Map(),
    initialized: false,
  });
const locks = runtime.locks;
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
  return withSessionVideoLock(row.ownerId, row.workoutId, () =>
    serialize(id, action),
  );
}
type Row = typeof workoutVideos.$inferSelect;
const key = (row: Row, part?: number) =>
  `workout-videos/${row.id}/${part === undefined ? 'video.mp4' : `part-${part}`}`;
const dto = (row: Row): WorkoutVideo => ({
  id: row.id,
  sessionId: row.workoutId,
  exerciseId: row.exerciseId,
  size: row.size,
  duration: row.duration,
  state: row.state,
  parts: Object.keys(row.parts).map(Number),
  name: row.name ?? '',
  recordedAt: row.recordedAt,
  createdAt: row.createdAt,
  playbackSize: row.playbackSize ?? (row.state === 'ready' ? row.size : null),
  progress: row.state === 'ready' ? 1 : row.processingProgress,
  error: row.processingError,
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
    .from(workouts)
    .where(and(eq(workouts.ownerId, ownerId), eq(workouts.id, sessionId)))
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
  target(ownerId, row.workoutId, row.exerciseId);
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
        eq(workoutVideos.workoutId, sessionId),
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
    if (session.data.status === 'planned') throw new WorkoutError(409);
    const existing = getDatabase()
      .db.select()
      .from(workoutVideos)
      .where(eq(workoutVideos.id, id))
      .get();
    if (existing) {
      if (
        existing.ownerId !== ownerId ||
        existing.workoutId !== input.sessionId ||
        existing.exerciseId !== input.exerciseId ||
        existing.size !== input.size ||
        (existing.name ?? '') !== input.name
      )
        throw new WorkoutError(409);
      if (existing.state === 'processing') kickWorkoutVideoProcessing();
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
          row.state !== 'ready' &&
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
      currentRows.filter((row) => row.state !== 'ready').length >= 10 ||
      currentRows.filter(
        (row) =>
          row.workoutId === input.sessionId &&
          row.exerciseId === input.exerciseId,
      ).length >= 8
    )
      throw new WorkoutError(409);
    return dto(
      getDatabase()
        .db.insert(workoutVideos)
        .values({
          workoutId: input.sessionId,
          exerciseId: input.exerciseId,
          size: input.size,
          id,
          ownerId,
          duration: 0,
          name: input.name,
          recordedAt:
            input.lastModified && input.lastModified <= Date.now() + 86_400_000
              ? input.lastModified
              : null,
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
    if (row.state === 'processing') {
      kickWorkoutVideoProcessing();
      return dto(row);
    }
    const count = Math.ceil(row.size / VIDEO_PART_BYTES);
    if (Object.keys(row.parts).length !== count) throw new WorkoutError(409);
    const saved = getDatabase()
      .db.update(workoutVideos)
      .set({
        state: 'processing',
        processingProgress: 0,
        processingError: null,
      })
      .where(eq(workoutVideos.id, id))
      .returning()
      .get();
    kickWorkoutVideoProcessing();
    return dto(saved);
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
    processingControllers.get(row.id)?.abort();
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
  const size = row.playbackSize ?? row.size;
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
  let range;
  try {
    range = videoRange(request.headers.get('range'), size);
  } catch {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set(
    'Content-Length',
    String(range ? range.end - range.start + 1 : size),
  );
  if (range)
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
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
        eq(workoutVideos.workoutId, sessionId),
      ),
    )
    .all();
}
export async function cleanupVideoRows(rows: Row[]) {
  for (const row of rows)
    await serialize(row.id, async () => {
      processingControllers.get(row.id)?.abort();
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

const processingControllers = runtime.controllers;
/** Durable state is the queue; a restart retries processing rows from their verified source parts. */
export function kickWorkoutVideoProcessing() {
  if (runtime.processing) return;
  runtime.processing = (async () => {
    if (!runtime.initialized) {
      await rm(workoutVideoTemporaryRoot(), { recursive: true, force: true });
      runtime.initialized = true;
    }
    const expired = getDatabase()
      .db.select()
      .from(workoutVideos)
      .where(
        and(
          ne(workoutVideos.state, 'ready'),
          lt(workoutVideos.createdAt, Date.now() - 24 * 60 * 60 * 1000),
        ),
      )
      .all();
    for (const row of expired) {
      await withSessionVideoLock(row.ownerId, row.workoutId, () =>
        cleanupVideoRows([row]),
      ).catch(() => {}); // Retry cleanup next pass without blocking unrelated uploads.
    }
    const ready = getDatabase()
      .db.select()
      .from(workoutVideos)
      .where(and(eq(workoutVideos.state, 'ready'), ne(workoutVideos.parts, {})))
      .limit(10)
      .all();
    for (const row of ready) {
      await withSessionVideoLock(row.ownerId, row.workoutId, () =>
        serialize(row.id, () => cleanupReadyVideoParts(row)),
      ).catch(() => {});
    }
    for (;;) {
      const row = getDatabase()
        .db.select()
        .from(workoutVideos)
        .where(eq(workoutVideos.state, 'processing'))
        .orderBy(asc(workoutVideos.createdAt))
        .get();
      if (!row) break;
      await processVideo(row);
    }
  })()
    .catch(() => {
      // Storage/DB outages retain the durable queue for the next bounded worker pass.
    })
    .finally(() => {
      runtime.processing = undefined;
    });
}
export function startWorkoutVideoWorker() {
  if (runtime.timer) return runtime.timer;
  kickWorkoutVideoProcessing();
  const timer = (runtime.timer = setInterval(kickWorkoutVideoProcessing, 5000));
  timer.unref();
  return timer;
}
async function processVideo(row: Row) {
  const controller = new AbortController();
  processingControllers.set(row.id, controller);
  const database = getDatabase().db;
  const storage = getObjectStorage();
  const predicate = and(
    eq(workoutVideos.id, row.id),
    eq(workoutVideos.createdAt, row.createdAt),
    eq(workoutVideos.state, 'processing'),
  );
  const assertCurrent = () => {
    controller.signal.throwIfAborted();
    const current = database
      .select()
      .from(workoutVideos)
      .where(predicate)
      .get();
    if (!current) throw new Error('Video removed');
    const workout = target(row.ownerId, row.workoutId, row.exerciseId);
    if (workout.data.status === 'planned')
      throw new VideoProcessingError('invalid');
    return current;
  };
  let lastProgress = 0;
  try {
    assertCurrent();
    database
      .update(workoutVideos)
      .set({ processingProgress: 0 })
      .where(predicate)
      .run();
    await transcodeWorkoutVideo(
      {
        size: row.size,
        signal: controller.signal,
        async readPart(part) {
          assertCurrent();
          const bytes = await storage.get(key(row, part));
          if (
            createHash('sha256').update(bytes).digest('hex') !== row.parts[part]
          )
            throw new VideoProcessingError('invalid');
          return bytes;
        },
        progress(value) {
          if (Date.now() - lastProgress < 500) return;
          lastProgress = Date.now();
          // A failed DB update must cancel the encoder rather than escape an event callback.
          try {
            assertCurrent();
            database
              .update(workoutVideos)
              .set({ processingProgress: value })
              .where(predicate)
              .run();
          } catch {
            controller.abort();
          }
        },
      },
      async (output) => {
        await withSessionVideoLock(row.ownerId, row.workoutId, () =>
          serialize(row.id, async () => {
            assertCurrent();
            await storage.putStream(
              key(row),
              output.body,
              output.size,
              'video/mp4',
            );
            try {
              assertCurrent();
            } catch (error) {
              await storage.remove(key(row));
              throw error;
            }
            const saved = database
              .update(workoutVideos)
              .set({
                state: 'ready',
                playbackSize: output.size,
                duration: output.duration,
                recordedAt: output.recordedAt ?? row.recordedAt,
                processingProgress: 1,
                processingError: null,
              })
              .where(predicate)
              .returning()
              .get();
            if (saved) await cleanupReadyVideoParts(saved);
          }),
        );
      },
    );
  } catch (error) {
    database
      .update(workoutVideos)
      .set({
        state: 'failed',
        processingProgress: 0,
        processingError:
          error instanceof VideoProcessingError ? error.code : 'processing',
      })
      .where(predicate)
      .run();
  } finally {
    if (processingControllers.get(row.id) === controller)
      processingControllers.delete(row.id);
  }
}
