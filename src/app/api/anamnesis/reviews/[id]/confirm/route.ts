import {
  confirmAnamnesisReview,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    checkAnamnesisOrigin(request);
    return Response.json(
      await confirmAnamnesisReview(
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
