import { createWorkoutSession } from '@/server/workouts';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';
export async function POST(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    return createWorkoutSession(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      await request.json(),
    );
  });
}
