import { withApiErrors } from '@/server/auth/api-response';
import { updateWorkout, deleteWorkout } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutUpdateBody,
  workoutDeleteBody,
  workoutResponse,
} from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
export const PUT = withApiErrors(async (request: Request, context: Context) =>
  workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const body = workoutUpdateBody.parse(await readWorkoutJson(request));
    return updateWorkout(
      request.headers,
      body.ownerId,
      (await context.params).id,
      body.revision,
      body.data,
      undefined,
      body.requestId,
    );
  }),
);
export const DELETE = withApiErrors(
  async (request: Request, context: Context) =>
    workoutResponse(async () => {
      checkWorkoutOrigin(request);
      const body = workoutDeleteBody.parse(await readWorkoutJson(request));
      await deleteWorkout(
        request.headers,
        body.ownerId,
        (await context.params).id,
        body.revision,
      );
      return null;
    }),
);
