import { updateWorkoutSession, deleteWorkoutSession } from '@/server/workouts';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const { revision, data } = await request.json();
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
    const { revision } = await request.json();
    await deleteWorkoutSession(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
      revision,
    );
    return null;
  });
}
