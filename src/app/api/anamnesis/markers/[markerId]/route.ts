import { getAnamnesisMarker, anamnesisErrorResponse } from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ markerId: string }> };
export async function GET(request: Request, context: Context) {
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
