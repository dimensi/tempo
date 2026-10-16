import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  confirmAnamnesisReview,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function POSTHandler(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    return Response.json(
      await confirmAnamnesisReview(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        (await context.params).id,
        await request.json(),
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const POST = withApiErrors(POSTHandler);
