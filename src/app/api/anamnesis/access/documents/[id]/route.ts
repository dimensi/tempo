import {
  setAnamnesisDocumentGrant,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
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
