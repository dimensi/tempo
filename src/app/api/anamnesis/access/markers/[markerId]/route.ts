import {
  setAnamnesisMarkerGrant,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ markerId: string }> };
export async function PUT(request: Request, context: Context) {
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
