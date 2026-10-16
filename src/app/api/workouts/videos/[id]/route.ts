import { withApiErrors } from '@/server/auth/api-response';
import { workoutResponse } from '@/server/workouts/http';
import { deleteVideo } from '@/server/workouts/videos';
async function DELETEHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return workoutResponse(() => deleteVideo(request, id));
}

export const DELETE = withApiErrors(DELETEHandler);
