import 'server-only';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { workouts } from '@/server/db/schema/workouts';
import { WorkoutAccessError } from './index';

export async function workoutEvents(request: Request, ownerId: string) {
  if (!ownerId || ownerId.length > 128) throw new WorkoutAccessError(400);
  const access = await authorize(request.headers, 'workouts:read', ownerId);
  if (!access.ok) throw new WorkoutAccessError(access.status);
  const db = getDatabase().db;
  const revision = () =>
    createHash('sha256')
      .update(
        JSON.stringify(
          db
            .select({ id: workouts.id, revision: workouts.revision })
            .from(workouts)
            .where(eq(workouts.ownerId, ownerId))
            .orderBy(workouts.id)
            .all(),
        ),
      )
      .digest('base64url');
  let previous = revision();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let closeStream: (() => void) | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    request.signal.removeEventListener('abort', abort);
  };
  const abort = () => {
    cleanup();
    closeStream?.();
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      closeStream = () => controller.close();
      if (request.signal.aborted) {
        abort();
        return;
      }
      request.signal.addEventListener('abort', abort, { once: true });
      const send = (value: string) => controller.enqueue(encoder.encode(value));
      send(`event: revision\ndata: ${JSON.stringify(previous)}\n\n`);
      let ticks = 0;
      timer = setInterval(() => {
        try {
          const current = revision();
          if (current !== previous) {
            previous = current;
            send(`event: revision\ndata: ${JSON.stringify(current)}\n\n`);
          } else if (++ticks % 15 === 0) send(': keepalive\n\n');
        } catch (error) {
          cleanup();
          controller.error(error);
        }
      }, 1000);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
      Vary: 'Cookie',
    },
  });
}
