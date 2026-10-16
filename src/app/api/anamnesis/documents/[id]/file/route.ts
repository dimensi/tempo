import {
  anamnesisErrorResponse,
  contentDisposition,
  getAnamnesisDocumentFile,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
async function GETHandler(request: Request, context: Context) {
  try {
    const { bytes, filename } = await getAnamnesisDocumentFile(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(filename, 'inline'),
      },
    });
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);
