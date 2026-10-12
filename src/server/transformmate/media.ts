import 'server-only';
import {
  getExercise,
  requireCatalogAccess,
  CatalogError,
  exerciseId,
} from '@/server/transformmate/catalog';

import { selectMediaUrl } from '@/server/transformmate/catalog-schema';
export { selectMediaUrl } from '@/server/transformmate/catalog-schema';
export async function streamExerciseVideo(
  request: Request,
  id: string,
  requestFetch: typeof fetch = fetch,
) {
  const ownerId = new URL(request.url).searchParams.get('ownerId') ?? '';
  const privateHeaders = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    await requireCatalogAccess(request.headers, ownerId);
    const range = request.headers.get('range');
    if (
      range &&
      !/^bytes=(?:[0-9]{1,16}-[0-9]{0,16}|-[0-9]{1,16})$/.test(range)
    )
      throw new CatalogError(416);
    const detail = await getExercise(request.headers, ownerId, exerciseId(id));
    const url = selectMediaUrl(detail);
    if (!url) throw new CatalogError(404);
    let upstream: Response;
    try {
      upstream = await requestFetch(url, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: range ? { Range: range } : {},
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new CatalogError(502);
    }
    try {
      await requireCatalogAccess(request.headers, ownerId);
    } catch (error) {
      await upstream.body?.cancel();
      throw error;
    }
    const type = upstream.headers.get('content-type')?.split(';')[0]?.trim();
    if (
      ![200, 206, 416].includes(upstream.status) ||
      (upstream.status !== 416 && type !== 'video/mp4')
    ) {
      await upstream.body?.cancel();
      throw new CatalogError(502);
    }
    const headers = new Headers(privateHeaders);
    if (upstream.status !== 416) headers.set('Content-Type', 'video/mp4');
    for (const key of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(key);
      if (value && /^[a-zA-Z0-9 */=.-]+$/.test(value)) headers.set(key, value);
    }
    if (request.method === 'HEAD' || upstream.status === 416)
      await upstream.body?.cancel();
    return new Response(
      request.method === 'HEAD' || upstream.status === 416
        ? null
        : upstream.body,
      { status: upstream.status, headers },
    );
  } catch (error) {
    return new Response(null, {
      status: error instanceof CatalogError ? error.status : 502,
      headers: privateHeaders,
    });
  }
}
