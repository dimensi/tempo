import { withApiErrors } from '@/server/auth/api-response';
import { readMealPhoto } from '@/server/nutrition';
import { json, respond, sameOrigin } from '@/server/nutrition/http';
import { deleteMealPhoto } from '@/server/nutrition/manual-photos';
async function GETHandler(
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
async function DELETEHandler(
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

export const GET = withApiErrors(GETHandler);

export const DELETE = withApiErrors(DELETEHandler);
