import { withApiErrors } from '@/server/auth/api-response';
import { workoutResponse } from '@/server/workouts/http';
import { uploadVideoPart } from '@/server/workouts/videos';
async function PUTHandler(
  request: Request,
  context: { params: Promise<{ id: string; part: string }> },
) {
  const { id, part } = await context.params;
  return workoutResponse(() => uploadVideoPart(request, id, Number(part)));
}

export const PUT = withApiErrors(PUTHandler);
