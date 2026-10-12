import {
  listTransformMateSync,
  refreshTransformMateSync,
} from '@/server/workouts/transformmate/service';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';
import { transformMateNativeQuerySchema } from '@/contracts/transformmate-native';

function query(request: Request) {
  const values = new URL(request.url).searchParams;
  return transformMateNativeQuerySchema.parse({
    from: values.get('from'),
    to: values.get('to'),
    cursor: values.get('cursor') ?? undefined,
    limit: values.get('limit') ?? undefined,
  });
}

export async function GET(request: Request) {
  return workoutResponse(() =>
    listTransformMateSync(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      query(request),
    ),
  );
}

export async function POST(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    return refreshTransformMateSync(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      query(request),
    );
  });
}
