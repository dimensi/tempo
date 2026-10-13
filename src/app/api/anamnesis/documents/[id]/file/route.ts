import {
  getAnamnesisDocumentFile,
  anamnesisErrorResponse,
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
    const { bytes, filename } = await getAnamnesisDocumentFile(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
    );
    const safeName = filename.replace(/[\r\n"]/g, '') || 'document.pdf';
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
      },
    });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}
