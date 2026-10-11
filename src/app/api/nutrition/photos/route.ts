import { listMealPhotos } from '@/server/nutrition';
import { uploadMealPhoto } from '@/server/nutrition/manual-photos';
import { nutritionAccess } from '@/server/nutrition/access';
import { MAX_IMAGE_BYTES } from '@/server/nutrition/images';
import { respond, json, sameOrigin, readBody } from '@/server/nutrition/http';
export async function GET(request: Request) {
  return respond(async () => {
    const q = new URL(request.url).searchParams;
    return json(
      await listMealPhotos(request.headers, q.get('ownerId') ?? '', {
        from: q.get('from') ?? '',
        to: q.get('to') ?? '',
      }),
    );
  });
}
// Raw binary avoids unbounded multipart parsing; metadata is in validated query parameters.
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    const q = new URL(request.url).searchParams;
    const ownerId = q.get('ownerId') ?? '';
    await nutritionAccess(request.headers, ownerId, 'nutrition:write');
    return json(
      await uploadMealPhoto(
        request.headers,
        ownerId,
        q.get('date') ?? '',
        q.get('daytime') ?? '',
        await readBody(request, MAX_IMAGE_BYTES),
        request.headers.get('content-type') ?? '',
      ),
      201,
    );
  });
}
