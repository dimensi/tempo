import 'server-only';
import { z, ZodError } from 'zod';
import { WorkoutAccessError, WorkoutError } from './index';
import { workoutMessages as m } from '@/features/workouts';
import { hasTrustedOrigin } from '@/server/auth/origin';
import { SyncAccessError } from './transformmate/service';
import { TransformMateStaleConnectionError } from '@/server/transformmate/token-store';
export const workoutUpdateBody = z
  .object({
    ownerId: z.string(),
    requestId: z.uuid().optional(),
    revision: z.unknown(),
    data: z.unknown(),
  })
  .strict();
export const workoutDeleteBody = z
  .object({ ownerId: z.string(), revision: z.unknown() })
  .strict();

export const workoutCreateBody = z.strictObject({
  ownerId: z.string(),
  requestId: z.uuid().optional(),
  data: z.unknown(),
});
export const workoutTransitionBody = workoutUpdateBody.extend({
  action: z.enum(['start', 'complete', 'resume']),
});

/** Bound bytes before parsing private notes/large plan arrays; never include body in errors. */
export async function readWorkoutJson(request: Request): Promise<unknown> {
  const limit = 8 * 1024 * 1024;
  const length = request.headers.get('content-length');
  if (length && Number(length) > limit) {
    await request.body?.cancel();
    throw new SyntaxError('Invalid workout request');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Invalid workout request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SyntaxError('Invalid workout request');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyntaxError('Invalid workout request');
  }
}

export async function workoutResponse(operation: () => Promise<unknown>) {
  try {
    return Response.json(
      {
        contractVersion: 2,
        source: 'user',
        data: await operation(),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const status =
      error instanceof WorkoutAccessError ||
      error instanceof WorkoutError ||
      error instanceof SyncAccessError
        ? error.status
        : error instanceof TransformMateStaleConnectionError
          ? 409
          : error instanceof ZodError || error instanceof SyntaxError
            ? 400
            : 500;
    const message =
      status === 409
        ? m.conflict
        : status === 404
          ? m.notFound
          : status === 403 || status === 401
            ? m.forbidden
            : status === 400
              ? m.validation
              : m.error;
    return Response.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

/** Browser mutations require a same-origin request; cookie auth alone is insufficient. */
export function checkWorkoutOrigin(request: Request) {
  if (!hasTrustedOrigin(request)) throw new WorkoutAccessError(403);
}
