import 'server-only';
import {
  getExercise,
  catalogScope,
  requireCatalogAccess,
  CatalogError,
  exerciseId,
} from '@/server/transformmate/catalog';

import { serveReplicaMedia } from './replica-playback';
import { replicaMediaRequest } from './replica-gate';
import { selectedVideo } from './replica-media';
import { getTransformMateConnectionFence } from '@/server/transformmate/runtime';
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
    const scope = await catalogScope(request.headers, ownerId);
    const local = await serveReplicaMedia(
      request,
      scope,
      exerciseId(id),
      'video',
    );
    if (local) return local;
    const range = request.headers.get('range');
    if (
      range &&
      !/^bytes=(?:[0-9]{1,16}-[0-9]{0,16}|-[0-9]{1,16})$/.test(range)
    )
      throw new CatalogError(416);
    const connection = await getTransformMateConnectionFence(ownerId);
    if (!connection) throw new CatalogError(503);
    let detail = await getExercise(request.headers, ownerId, exerciseId(id));
    let url = selectedVideo(detail)?.url ?? null;
    let refreshedMetadata = false;
    if (!url) {
      refreshedMetadata = true;
      detail = await getExercise(
        request.headers,
        ownerId,
        exerciseId(id),
        true,
      );
      url = selectedVideo(detail)?.url ?? null;
    }
    if (!url) throw new CatalogError(404);
    let upstream: Response;
    await connection.assertCurrent();
    const fetchMedia = (target: URL) =>
      replicaMediaRequest(
        scope,
        () =>
          requestFetch(target, {
            method: request.method === 'HEAD' ? 'HEAD' : 'GET',
            headers: range ? { Range: range } : {},
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(30000),
            ]),
          }),
        request.signal,
      );
    try {
      upstream = await fetchMedia(url);
      if (
        !refreshedMetadata &&
        [401, 403, 404, 410].includes(upstream.status)
      ) {
        await upstream.body?.cancel();
        await requireCatalogAccess(request.headers, ownerId);
        await connection.assertCurrent();
        detail = await getExercise(
          request.headers,
          ownerId,
          exerciseId(id),
          true,
        );
        const refreshed = selectedVideo(detail)?.url ?? null;
        if (!refreshed) throw new CatalogError(404);
        upstream = await fetchMedia(refreshed);
      }
    } catch {
      throw new CatalogError(502);
    }
    try {
      await requireCatalogAccess(request.headers, ownerId);
      await connection.assertCurrent();
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
    const contentRange = upstream.headers.get('content-range');
    if (upstream.status === 206) {
      const match = contentRange?.match(
        /^bytes ([0-9]{1,16})-([0-9]{1,16})\/([0-9]{1,16})$/,
      );
      const [start, end, total] = match?.slice(1).map(Number) ?? [];
      if (
        !range ||
        !match ||
        ![start, end, total].every(Number.isSafeInteger) ||
        start! > end! ||
        end! >= total!
      ) {
        await upstream.body?.cancel();
        throw new CatalogError(502);
      }
    }
    const headers = new Headers(privateHeaders);
    if (upstream.status === 416) {
      const match = contentRange?.match(/^bytes \*\/([0-9]{1,16})$/);
      if (match && Number.isSafeInteger(Number(match[1])))
        headers.set('Content-Range', contentRange!);
    } else {
      headers.set('Content-Type', 'video/mp4');
      const length = upstream.headers.get('content-length');
      if (
        length &&
        /^[0-9]{1,16}$/.test(length) &&
        Number.isSafeInteger(Number(length))
      )
        headers.set('Content-Length', length);
      if (upstream.status === 206) headers.set('Content-Range', contentRange!);
      if (upstream.headers.get('accept-ranges') === 'bytes')
        headers.set('Accept-Ranges', 'bytes');
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
