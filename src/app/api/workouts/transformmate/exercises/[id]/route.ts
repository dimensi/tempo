import { withApiErrors } from '@/server/auth/api-response';
import {
  catalogResponse,
  exerciseId,
  exerciseInfo,
} from '@/server/transformmate/catalog';
async function GETHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return catalogResponse(() =>
    exerciseInfo(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      exerciseId(id),
    ),
  );
}

export const GET = withApiErrors(GETHandler);
