import 'server-only';
import { getObjectStorage } from '@/server/storage';
import type { CatalogScope } from './catalog-cache';
import { replicaStore } from './replica-store';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
export async function serveReplicaMedia(
  request: Request,
  scope: CatalogScope,
  id: number,
  kind: 'video' | 'preview',
) {
  const job = replicaStore().job(scope, `exercise:${id}`);
  const object =
    kind === 'video' ? job?.data.video : (job?.data.poster ?? job?.data.image);
  if (!object) return null;
  await scope.assertCurrent();
  const range = request.headers.get('range');
  let span: { start: number; end: number } | undefined;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${object.size}` },
      });
    const start = match[1]
      ? Number(match[1])
      : Math.max(0, object.size - Number(match[2]));
    const end = match[1]
      ? match[2]
        ? Math.min(Number(match[2]), object.size - 1)
        : object.size - 1
      : object.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= object.size ||
      (!match[1] && Number(match[2]) === 0)
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${object.size}` },
      });
    span = { start, end };
  }
  let stored: Awaited<
    ReturnType<ReturnType<typeof getObjectStorage>['readStream']>
  >;
  try {
    stored = await getObjectStorage().readStream(object.key, span);
  } catch {
    return null;
  }
  try {
    await scope.assertCurrent();
  } catch (error) {
    await stored.body.cancel();
    throw error;
  }
  const length = span ? span.end - span.start + 1 : object.size;
  if (stored.size !== length && stored.size !== object.size) {
    await stored.body.cancel();
    return null;
  }
  const output = new Headers({
    ...headers,
    'Content-Type': object.type,
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
  });
  if (span)
    output.set(
      'Content-Range',
      `bytes ${span.start}-${span.end}/${object.size}`,
    );
  if (request.method === 'HEAD') {
    await stored.body.cancel();
    return new Response(null, { status: span ? 206 : 200, headers: output });
  }
  const reader = stored.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener('abort', abort, { once: true });
  const release = () => {
    request.signal.removeEventListener('abort', abort);
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel() {
      try {
        await reader.cancel();
      } finally {
        release();
      }
    },
  });
  if (request.signal.aborted) abort();
  return new Response(body, {
    status: span ? 206 : 200,
    headers: output,
  });
}
