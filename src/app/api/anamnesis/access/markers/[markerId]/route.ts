import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  setAnamnesisMarkerGrant,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ markerId: string }> };
async function PUTHandler(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    await setAnamnesisMarkerGrant(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).markerId,
      await request.json(),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const PUT = withApiErrors(PUTHandler);
