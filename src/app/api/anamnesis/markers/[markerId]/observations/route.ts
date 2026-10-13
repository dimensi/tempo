import {
  listMarkerObservations,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ markerId: string }> };
export async function GET(request: Request, context: Context) {
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
