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
export { handle as GET, handle as HEAD };
