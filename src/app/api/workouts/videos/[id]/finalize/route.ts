import { finalizeVideo } from '@/server/workouts/videos';
import { workoutResponse } from '@/server/workouts/http';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return workoutResponse(() => finalizeVideo(request, id));
}
