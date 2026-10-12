import { streamExerciseVideo } from '@/server/transformmate/media';
async function video(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return streamExerciseVideo(request, (await context.params).id);
}
export const GET = video;
export const HEAD = video;
