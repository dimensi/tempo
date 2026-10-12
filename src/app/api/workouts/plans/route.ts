import { createWorkoutPlan } from '@/server/workouts';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';
export async function POST(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const body = await request.json();
    return createWorkoutPlan(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      body,
      request.headers.get('idempotency-key') ?? undefined,
    );
  });
}
