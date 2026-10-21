import {
  anamnesisErrorResponse,
  listAnamnesisCatalog,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function GETHandler(request: Request) {
  try {
    return Response.json(
      await listAnamnesisCatalog(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
export const GET = withApiErrors(GETHandler);
