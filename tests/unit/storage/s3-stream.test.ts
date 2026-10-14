import { afterAll, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
vi.mock('server-only', () => ({}));
const { s3ObjectStorage } = await import('@/server/storage/s3');
let saved = Buffer.alloc(0),
  rangeHeader: string | undefined;
const server = createServer(async (request, response) => {
  if (request.method === 'PUT') {
    const pieces: Buffer[] = [];
    for await (const chunk of request) pieces.push(chunk);
    saved = Buffer.concat(pieces);
    response.setHeader('ETag', '"synthetic"');
    response.end();
  } else if (request.method === 'GET') {
    rangeHeader = request.headers.range;
    if (rangeHeader) {
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes 2-5/${saved.length}`);
      response.setHeader('Content-Length', '4');
      Readable.from([saved.subarray(2, 6)]).pipe(response);
    } else {
      response.setHeader('Content-Length', String(saved.length));
      Readable.from([saved]).pipe(response);
    }
  } else {
    response.statusCode = 204;
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('Synthetic listener');
const storage = s3ObjectStorage({
  endpoint: `http://127.0.0.1:${address.port}`,
  region: 'us-east-1',
  bucket: 'synthetic',
  accessKeyId: 'synthetic-access',
  secretAccessKey: 'synthetic-secret',
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
it('uses the existing S3 adapter credentials and SDK for streaming PutObject and Range GetObject', async () => {
  async function* chunks() {
    yield new Uint8Array([0, 1, 2]);
    yield new Uint8Array([3, 4, 5, 6, 7]);
  }
  await storage.putStream(
    'workout-videos/test/video.mp4',
    chunks(),
    8,
    'video/mp4',
  );
  expect(saved).toEqual(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  const object = await storage.readStream('workout-videos/test/video.mp4', {
    start: 2,
    end: 5,
  });
  expect(Buffer.from(await new Response(object.body).arrayBuffer())).toEqual(
    Buffer.from([2, 3, 4, 5]),
  );
  expect(rangeHeader).toBe('bytes=2-5');
  await expect(storage.readStream('../escape')).rejects.toThrow(
    'Invalid storage key',
  );
});
