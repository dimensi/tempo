import 'server-only';
import { ZodError } from 'zod';
import { progressQuerySchema } from '@/contracts/exercise-progress';
import { WorkoutAccessError } from './index';
import { SyncAccessError } from './transformmate/service';
import { SavedWorkoutRangeError } from './saved-read';
import { readProgressHistory, readProgressSummary } from './progress';

export async function progressResponse(
  request: Request,
  kind: 'history' | 'summary',
) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const params = new URL(request.url).searchParams;
    const query = progressQuerySchema.parse({
      ownerId: params.get('ownerId'),
      from: params.get('from'),
      to: params.get('to'),
      exerciseIds: params.has('exerciseIds')
        ? params.get('exerciseIds')!.split(',').map(Number)
        : undefined,
      exerciseId: params.has('exerciseId')
        ? Number(params.get('exerciseId'))
        : undefined,
      workoutId: params.get('workoutId') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    });
    if (kind === 'history' && !query.exerciseId)
      return Response.json(
        { error: 'Invalid exercise' },
        { status: 400, headers },
      );
    const data = await (
      kind === 'history' ? readProgressHistory : readProgressSummary
    )(request.headers, query);
    return Response.json(data, { headers });
  } catch (error) {
    const status =
      error instanceof WorkoutAccessError || error instanceof SyncAccessError
        ? error.status
        : error instanceof ZodError || error instanceof SavedWorkoutRangeError
          ? 400
          : 503;
    return Response.json(
      { error: 'Progress unavailable' },
      { status, headers },
    );
  }
}
