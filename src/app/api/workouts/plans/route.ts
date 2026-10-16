import { withApiErrors } from '@/server/auth/api-response';
import { createWorkoutPlan } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutResponse,
} from '@/server/workouts/http';
async function POSTHandler(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const body = await readWorkoutJson(request);
    return createWorkoutPlan(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      body,
      request.headers.get('idempotency-key') ?? undefined,
    );
  });
}

export const POST = withApiErrors(POSTHandler);
