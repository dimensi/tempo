import { updateWorkoutPlan, deleteWorkoutPlan } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  workoutResponse,
  workoutUpdateBody,
  workoutDeleteBody,
  readWorkoutJson,
} from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
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
export async function DELETE(request: Request, context: Context) {
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
