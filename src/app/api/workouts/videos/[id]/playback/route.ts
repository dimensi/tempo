import { withApiErrors } from '@/server/auth/api-response';
import { playbackVideo } from '@/server/workouts/videos';
import { workoutResponse } from '@/server/workouts/http';
async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    return await playbackVideo(request, id);
  } catch (error) {
    return workoutResponse(() => Promise.reject(error));
  }
}
export const GET = withApiErrors(handle);
export const HEAD = GET;
