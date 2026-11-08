import 'server-only';
import { getObjectStorage } from '@/server/storage';
import { videoRange } from './video-range';

export async function readVideoPart(request: Request, expected: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.length > expected) {
        await reader.cancel();
        throw new SyntaxError();
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expected) throw new SyntaxError();
  return bytes;
}

export async function streamPrivateVideo(
  request: Request,
  key: string,
  size: number,
  assertCurrent: () => Promise<unknown>,
) {
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
  let range;
  try {
    range = videoRange(request.headers.get('range'), size);
  } catch {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set(
    'Content-Length',
    String(range ? range.end - range.start + 1 : size),
  );
  if (range)
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  if (request.method === 'HEAD')
    return new Response(null, { status: range ? 206 : 200, headers });
  const source = await getObjectStorage().readStream(key, range ?? undefined);
  const reader = source.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await assertCurrent();
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        await reader.cancel();
        controller.error(error);
      }
    },
    cancel: () => reader.cancel(),
  });
  return new Response(body, { status: range ? 206 : 200, headers });
}
