import { withApiErrors } from '@/server/auth/api-response';
import { streamExercisePreview } from '@/server/transformmate/preview';
async function GETHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return streamExercisePreview(request, (await context.params).id);
}

export const GET = withApiErrors(GETHandler);
