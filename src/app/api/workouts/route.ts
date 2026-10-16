import { withApiErrors } from '@/server/auth/api-response';
import { listWorkouts } from '@/server/workouts';
import { workoutResponse } from '@/server/workouts/http';
async function GETHandler(request: Request) {
  return workoutResponse(() =>
    listWorkouts(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}

export const GET = withApiErrors(GETHandler);
