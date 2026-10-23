import { withApiErrors } from '@/server/auth/api-response';
import { createWorkout, listWorkouts } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutCreateBody,
  workoutResponse,
} from '@/server/workouts/http';
export const GET = withApiErrors(async (request: Request) =>
  workoutResponse(() =>
    listWorkouts(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  ),
);
export const POST = withApiErrors(async (request: Request) =>
  workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const body = workoutCreateBody.parse(await readWorkoutJson(request));
    return createWorkout(
      request.headers,
      body.ownerId,
      body.data,
      body.requestId,
    );
  }),
);
