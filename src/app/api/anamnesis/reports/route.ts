import {
  listAnamnesisReports,
  createAnamnesisReport,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
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
export async function POST(request: Request) {
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
