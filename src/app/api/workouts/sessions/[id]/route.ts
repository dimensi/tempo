import { updateWorkoutSession, deleteWorkoutSession } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  workoutResponse,
  workoutUpdateBody,
  workoutDeleteBody,
} from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const { revision, data } = workoutUpdateBody.parse(await request.json());
    return updateWorkoutSession(
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
    const { revision } = workoutDeleteBody.parse(await request.json());
    await deleteWorkoutSession(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
      revision,
    );
    return null;
  });
}
