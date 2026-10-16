import { anamnesisErrorResponse, getAnamnesisMarker } from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ markerId: string }> };
async function GETHandler(request: Request, context: Context) {
  try {
    return Response.json(
      await getAnamnesisMarker(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        (await context.params).markerId,
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);
