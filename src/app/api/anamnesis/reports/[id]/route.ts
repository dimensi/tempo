import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  deleteAnamnesisReport,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function DELETEHandler(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    await deleteAnamnesisReport(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const DELETE = withApiErrors(DELETEHandler);
