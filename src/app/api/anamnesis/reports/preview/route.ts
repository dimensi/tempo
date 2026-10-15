import {
  previewAnamnesisReport,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
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
