import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  correctAnamnesisObservation,
  getAnamnesisObservation,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function GETHandler(request: Request, context: Context) {
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
async function PATCHHandler(request: Request, context: Context) {
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

export const GET = withApiErrors(GETHandler);

export const PATCH = withApiErrors(PATCHHandler);
