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
  const query = new URL(request.url).searchParams;
  return catalogResponse(() =>
    exerciseInfo(
      request.headers,
      query.get('ownerId') ?? '',
      exerciseId(id),
      query.get('verifyOwnership') === '1',
    ),
  );
}

export const GET = withApiErrors(GETHandler);
