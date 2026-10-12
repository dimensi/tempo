import 'server-only';
import { request } from 'node:https';
import type { LookupAddress } from 'node:dns';

const CHUNK_BYTES = 8192;
const MAX_CHUNKS = 64;
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Bounded recovery for interrupted CDN bodies. Caller has already validated
// the URL and every DNS answer; each segment keeps the original TLS hostname.
export async function fetchImageRanges(url: URL, addresses: LookupAddress[]) {
  const budget = AbortSignal.timeout(45000);
  let total = 0;
  let etag = '';
  let mime = '';
  const chunks: Buffer[] = [];
  for (let start = 0; start === 0 || start < total; start += CHUNK_BYTES) {
    const segment = await new Promise<{
      bytes: Buffer;
      total: number;
      etag: string;
      mime: string;
    }>((resolve, reject) => {
      const req = request(
        url,
        {
          agent: false,
          signal: AbortSignal.any([budget, AbortSignal.timeout(15000)]),
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0]!.address, addresses[0]!.family);
          },
          headers: {
            Accept: MIME_TYPES.join(','),
            Range: `bytes=${start}-${start + CHUNK_BYTES - 1}`,
            ...(etag ? { 'If-Range': etag } : {}),
          },
        },
        (response) => {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
            String(response.headers['content-range'] ?? ''),
          );
          const size = Number(range?.[3]);
          const end = Math.min(start + CHUNK_BYTES, size) - 1;
          const tag = response.headers.etag;
          const type =
            response.headers['content-type']?.split(';')[0]?.trim() ?? '';
          if (
            response.statusCode !== 206 ||
            !range ||
            Number(range[1]) !== start ||
            Number(range[2]) !== end ||
            !Number.isSafeInteger(size) ||
            size <= start ||
            size > CHUNK_BYTES * MAX_CHUNKS ||
            Number(response.headers['content-length']) !== end - start + 1 ||
            typeof tag !== 'string' ||
            !/^"[^"\r\n]+"$/.test(tag) ||
            !MIME_TYPES.includes(type) ||
            (total && size !== total) ||
            (etag && tag !== etag) ||
            (mime && type !== mime) ||
            (response.headers['content-encoding'] &&
              response.headers['content-encoding'] !== 'identity')
          ) {
            response.destroy();
            reject(new Error('Invalid image range response'));
            return;
          }
          const parts: Buffer[] = [];
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > end - start + 1)
              response.destroy(new Error('Invalid image range size'));
            else parts.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            if (!response.complete || received !== end - start + 1)
              reject(new Error('Incomplete image range'));
            else
              resolve({
                bytes: Buffer.concat(parts),
                total: size,
                etag: tag,
                mime: type,
              });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
    total = segment.total;
    etag = segment.etag;
    mime = segment.mime;
    chunks.push(segment.bytes);
  }
  return { bytes: Buffer.concat(chunks), mime };
}
