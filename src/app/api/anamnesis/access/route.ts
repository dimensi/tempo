import {
  anamnesisErrorResponse,
  getAnamnesisAccess,
  setAnamnesisAccess,
  checkAnamnesisOrigin,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GETHandler(request: Request) {
  try {
    return Response.json(
      await getAnamnesisAccess(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);

async function PUTHandler(request: Request) {
  try {
    checkAnamnesisOrigin(request);
    await setAnamnesisAccess(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      await request.json(),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
export const PUT = withApiErrors(PUTHandler);
