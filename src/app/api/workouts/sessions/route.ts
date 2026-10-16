import { withApiErrors } from '@/server/auth/api-response';
import { createWorkoutSession } from '@/server/workouts';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';
async function POSTHandler(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    return createWorkoutSession(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      await request.json(),
    );
  });
}

export const POST = withApiErrors(POSTHandler);
