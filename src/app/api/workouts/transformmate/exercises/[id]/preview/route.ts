import { streamExercisePreview } from '@/server/transformmate/preview';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return streamExercisePreview(request, (await context.params).id);
}
