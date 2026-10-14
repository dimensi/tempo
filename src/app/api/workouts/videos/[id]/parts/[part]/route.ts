import { uploadVideoPart } from '@/server/workouts/videos';
import { workoutResponse } from '@/server/workouts/http';
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; part: string }> },
) {
  const { id, part } = await context.params;
  return workoutResponse(() => uploadVideoPart(request, id, Number(part)));
}
