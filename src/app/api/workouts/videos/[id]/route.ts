import { deleteVideo } from '@/server/workouts/videos';
import { workoutResponse } from '@/server/workouts/http';
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return workoutResponse(() => deleteVideo(request, id));
}
