import 'server-only';
import {
  CatalogError,
  catalogScope,
  exerciseId,
} from '@/server/transformmate/catalog';
import { cachedDetail } from '@/server/transformmate/catalog-cache';
import { catalogStore } from '@/server/transformmate/catalog-store';
import { selectPreviewUrl, matchesSignature } from './preview-validation';
import { serveReplicaMedia } from './replica-playback';
import { replicaMediaRequest } from './replica-gate';
const PREVIEW_FAILURE_RETRY_MS = 60_000;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
export async function streamExercisePreview(
  request: Request,
  idValue: string,
  requestFetch: typeof fetch = fetch,
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    const id = exerciseId(idValue);
    const ownerId = new URL(request.url).searchParams.get('ownerId') ?? '';
    const scope = await catalogScope(request.headers, ownerId);
    const local = await serveReplicaMedia(request, scope, id, 'preview');
    if (local) return local;
    if (!scope.client) throw new CatalogError(503);
    const cached = catalogStore().record(scope, id);
    if (
      cached?.detail?.previewCoverage === 'unknown' &&
      cached.detail.previewCheckedAt &&
      Date.now() - Date.parse(cached.detail.previewCheckedAt) <
        PREVIEW_FAILURE_RETRY_MS
    )
      throw new CatalogError(502);
    let record = await cachedDetail(scope, id);
    let url = selectPreviewUrl(record.detail!.image);
    if (!url) throw new CatalogError(404);
    await scope.assertCurrent();
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(10000),
    ]);
    const markUnknown = async () => {
      try {
        await scope.assertCurrent();
        catalogStore().preview(
          scope,
          id,
          record.detailFetchedAt!,
          record.detail!.image,
          'unknown',
          new Date().toISOString(),
        );
      } catch {
        /* Revocation forbids cache writes too. */
      }
    };
    const fetchImage = (target: URL) =>
      replicaMediaRequest(scope, () =>
        requestFetch(target, {
          headers: {},
          redirect: 'error',
          cache: 'no-store',
          signal,
        }),
      ).catch(async (error: unknown) => {
        await markUnknown();
        throw error;
      });
    let upstream = await fetchImage(url);
    if ([401, 403, 404, 410].includes(upstream.status)) {
      await upstream.body?.cancel();
      await scope.assertCurrent();
      await markUnknown();
      const previousUrl = url.href;
      record = await cachedDetail(scope, id, true);
      await scope.assertCurrent();
      url = selectPreviewUrl(record.detail!.image);
      if (!url) throw new CatalogError(404);
      if (url.href === previousUrl) {
        await markUnknown();
        throw new CatalogError(
          [404, 410].includes(upstream.status) ? 404 : 502,
        );
      }
      upstream = await fetchImage(url);
    }
    try {
      await scope.assertCurrent();
      if ([404, 410].includes(upstream.status)) throw new CatalogError(404);
      const type =
        upstream.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      const declared = upstream.headers.get('content-length');
      if (
        upstream.status !== 200 ||
        !TYPES.has(type) ||
        (declared &&
          (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BYTES))
      )
        throw new CatalogError(502);
      const reader = upstream.body?.getReader();
      if (!reader) throw new CatalogError(502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            throw new CatalogError(502);
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (!matchesSignature(bytes, type)) throw new CatalogError(502);
      await scope.assertCurrent();
      catalogStore().preview(
        scope,
        id,
        record.detailFetchedAt!,
        record.detail!.image,
        'available',
        new Date().toISOString(),
      );
      return new Response(bytes, {
        headers: {
          ...headers,
          'Content-Type': type,
          'Content-Length': String(size),
        },
      });
    } catch (error) {
      await upstream.body?.cancel().catch(() => {});
      await markUnknown();
      throw error;
    }
  } catch (error) {
    return new Response(null, {
      status: error instanceof CatalogError ? error.status : 502,
      headers,
    });
  }
}
