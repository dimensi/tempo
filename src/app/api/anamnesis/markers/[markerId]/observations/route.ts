import {
  anamnesisErrorResponse,
  listMarkerObservations,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ markerId: string }> };
async function GETHandler(request: Request, context: Context) {
  try {
    const query = new URL(request.url).searchParams;
    return Response.json(
      await listMarkerObservations(
        request.headers,
        query.get('ownerId') ?? '',
        (await context.params).markerId,
        {
          from: query.get('from') ?? undefined,
          to: query.get('to') ?? undefined,
        },
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);
