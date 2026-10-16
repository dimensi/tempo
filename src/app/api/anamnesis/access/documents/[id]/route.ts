import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  setAnamnesisDocumentGrant,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function PUTHandler(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    await setAnamnesisDocumentGrant(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
      await request.json(),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const PUT = withApiErrors(PUTHandler);
