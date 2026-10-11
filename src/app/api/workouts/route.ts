import { listWorkouts } from '@/server/workouts';
import { workoutResponse } from '@/server/workouts/http';
export async function GET(request: Request) {
  return workoutResponse(() =>
    listWorkouts(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}
