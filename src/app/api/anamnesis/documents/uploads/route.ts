import {
  anamnesisErrorResponse,
  anamnesisUploadLimits,
  checkAnamnesisOrigin,
  uploadAnamnesisDocument,
} from '@/server/anamnesis';
import { withApiErrors } from '@/server/auth/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function POSTHandler(request: Request) {
  try {
    checkAnamnesisOrigin(request);
    // Ранние границы размера: до буферизации тела.
    const declared = Number(request.headers.get('content-length'));
    if (
      Number.isFinite(declared) &&
      declared > anamnesisUploadLimits().maxBytes + 65536
    )
      return Response.json({ error: 'Файл слишком большой' }, { status: 413 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return Response.json({ error: 'Файл не передан' }, { status: 400 });
    if (file.size > anamnesisUploadLimits().maxBytes)
      return Response.json({ error: 'Файл слишком большой' }, { status: 413 });
    return Response.json(
      await uploadAnamnesisDocument(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        {
          filename: file.name || 'document.pdf',
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
      ),
      { status: 201 },
    );
  } catch (error) {
    return anamnesisErrorResponse(error);
  }
}

export const POST = withApiErrors(POSTHandler);
