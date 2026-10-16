import { withApiErrors } from '@/server/auth/api-response';
import { workoutResponse } from '@/server/workouts/http';
import { finalizeVideo } from '@/server/workouts/videos';
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return workoutResponse(() => finalizeVideo(request, id));
}

export const POST = withApiErrors(POSTHandler);
