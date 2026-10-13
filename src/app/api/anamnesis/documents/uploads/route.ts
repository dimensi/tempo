import {
  uploadAnamnesisDocument,
  checkAnamnesisOrigin,
  anamnesisErrorResponse,
} from '@/server/anamnesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    checkAnamnesisOrigin(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return Response.json({ error: 'Файл не передан' }, { status: 400 });
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
