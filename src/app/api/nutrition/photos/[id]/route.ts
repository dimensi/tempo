import { readMealPhoto } from '@/server/nutrition';
import { deleteMealPhoto } from '@/server/nutrition/manual-photos';
import { respond, json, sameOrigin } from '@/server/nutrition/http';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const { id } = await context.params;
    const { bytes, contentType } = await readMealPhoto(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Content-Disposition': 'inline',
      },
    });
  });
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    sameOrigin(request);
    const { id } = await context.params;
    await deleteMealPhoto(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      id,
    );
    return json({ deleted: true });
  });
}
