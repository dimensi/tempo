import { withApiErrors } from '@/server/auth/api-response';
import { deleteWorkoutPlan, updateWorkoutPlan } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutDeleteBody,
  workoutResponse,
  workoutUpdateBody,
} from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
async function PUTHandler(request: Request, context: Context) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const { revision, data } = workoutUpdateBody.parse(
      await readWorkoutJson(request),
    );
    return updateWorkoutPlan(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
      revision,
      data,
    );
  });
}
async function DELETEHandler(request: Request, context: Context) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const { revision } = workoutDeleteBody.parse(
      await readWorkoutJson(request),
    );
    await deleteWorkoutPlan(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
      revision,
    );
    return null;
  });
}

export const PUT = withApiErrors(PUTHandler);

export const DELETE = withApiErrors(DELETEHandler);
