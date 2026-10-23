import { withApiErrors } from '@/server/auth/api-response';
import { updateWorkout } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutTransitionBody,
  workoutResponse,
} from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
export const POST = withApiErrors(async (request: Request, context: Context) =>
  workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const body = workoutTransitionBody.parse(await readWorkoutJson(request));
    return updateWorkout(
      request.headers,
      body.ownerId,
      (await context.params).id,
      body.revision,
      body.data,
      body.action,
      body.requestId,
    );
  }),
);
