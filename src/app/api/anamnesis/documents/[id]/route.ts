import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  deleteAnamnesisDocument,
  getAnamnesisDocument,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function GETHandler(request: Request, context: Context) {
  try {
    return Response.json(
      await getAnamnesisDocument(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        (await context.params).id,
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
async function DELETEHandler(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    await deleteAnamnesisDocument(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);

export const DELETE = withApiErrors(DELETEHandler);
