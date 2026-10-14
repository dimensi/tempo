import {
  getAnamnesisObservation,
  correctAnamnesisObservation,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return Response.json(
      await getAnamnesisObservation(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        (await context.params).id,
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    return Response.json(
      await correctAnamnesisObservation(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        (await context.params).id,
        await request.json(),
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
