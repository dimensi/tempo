import {
  getAnamnesisReportFile,
  anamnesisErrorResponse,
  contentDisposition,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
export async function GET(request: Request, context: Context) {
  try {
    const { bytes, filename } = await getAnamnesisReportFile(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/pdf',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
        'Content-Disposition': contentDisposition(
          filename,
          new URL(request.url).searchParams.get('inline') === '1'
            ? 'inline'
            : 'attachment',
        ),
      },
    });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
