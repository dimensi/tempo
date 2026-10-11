import 'server-only';
import { ZodError } from 'zod';
import { WorkoutAccessError, WorkoutError } from './index';
import { workoutMessages as m } from '@/features/workouts';

export async function workoutResponse(operation: () => Promise<unknown>) {
  try {
    return Response.json({
      contractVersion: 1,
      source: 'user',
      data: await operation(),
    });
  } catch (error) {
    const status =
      error instanceof WorkoutAccessError || error instanceof WorkoutError
        ? error.status
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
    return Response.json({ error: message }, { status });
  }
}

/** Browser mutations require a same-origin request; cookie auth alone is insufficient. */
export function checkWorkoutOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    throw new WorkoutAccessError(403);
}
