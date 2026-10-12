import {
  listTransformMateSync,
  refreshTransformMateSync,
} from '@/server/workouts/transformmate/service';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';

export async function GET(request: Request) {
  return workoutResponse(() =>
    listTransformMateSync(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}

export async function POST(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    return refreshTransformMateSync(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    );
  });
}
