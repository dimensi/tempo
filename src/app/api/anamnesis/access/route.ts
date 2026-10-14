import { getAnamnesisAccess, anamnesisErrorResponse } from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return Response.json(
      await getAnamnesisAccess(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
      ),
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
