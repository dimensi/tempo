import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  createAnamnesisReport,
  listAnamnesisReports,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function GETHandler(request: Request) {
  try {
    return Response.json(
      await listAnamnesisReports(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
async function POSTHandler(request: Request) {
  try {
    checkAnamnesisOrigin(request);
    return Response.json(
      await createAnamnesisReport(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);

export const POST = withApiErrors(POSTHandler);
