import {
  anamnesisErrorResponse,
  checkAnamnesisOrigin,
  previewAnamnesisReport,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function POSTHandler(request: Request) {
  try {
    checkAnamnesisOrigin(request);
    const result = await previewAnamnesisReport(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      await request.json(),
      request.signal,
    );
    return Response.json(result, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const POST = withApiErrors(POSTHandler);
