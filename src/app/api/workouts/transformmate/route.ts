import { transformMateNativeQuerySchema } from '@/contracts/transformmate-native';
import { withApiErrors } from '@/server/auth/api-response';
import { checkWorkoutOrigin, workoutResponse } from '@/server/workouts/http';
import {
  listTransformMateSync,
  refreshTransformMateSync,
} from '@/server/workouts/transformmate/service';

function query(request: Request) {
  const values = new URL(request.url).searchParams;
  return transformMateNativeQuerySchema.parse({
    from: values.get('from'),
    to: values.get('to'),
    cursor: values.get('cursor') ?? undefined,
    limit: values.get('limit') ?? undefined,
  });
}

async function GETHandler(request: Request) {
  return workoutResponse(() =>
    listTransformMateSync(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      query(request),
    ),
  );
}

async function POSTHandler(request: Request) {
  return workoutResponse(async () => {
    checkWorkoutOrigin(request);
    return refreshTransformMateSync(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      query(request),
    );
  });
}

export const GET = withApiErrors(GETHandler);

export const POST = withApiErrors(POSTHandler);
