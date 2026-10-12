import 'server-only';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readServerEnv } from '@/server/env';
import { fetchImageRanges } from './image-ranges';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function validateImage(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error('Invalid image size');
  const b = Buffer.from(bytes);
  const valid =
    mime === 'image/jpeg'
      ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      : mime === 'image/png'
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/webp'
          ? b.subarray(0, 4).toString() === 'RIFF' &&
            b.subarray(8, 12).toString() === 'WEBP'
          : false;
  if (!valid) throw new Error('Invalid image format');
  return b;
}
export function validateCdnUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'images.yazio-cdn.com' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error('Invalid image host');
  return url;
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a !== 169 &&
      a !== 192 &&
      a! < 224 &&
      !(a === 172 && b! >= 16 && b! <= 31) &&
      !(a === 100 && b! >= 64 && b! <= 127) &&
      !(a === 198 && (b === 18 || b === 19))
    );
  }
  // Only globally routable IPv6 unicast; exclude mapped/local/documentation ranges.
  return (
    isIP(address) === 6 &&
    /^[23]/i.test(address) &&
    !address.toLowerCase().startsWith('2001:db8:')
  );
}
export async function fetchCdnImage(value: string) {
  const url = validateCdnUrl(value);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('Invalid image address');
  // Pin validated DNS answers; HTTPS still validates the original CDN hostname.
  const address = addresses[0]!;
  return new Promise<{ bytes: Buffer; mime: string }>(
    (resolveImage, reject) => {
      const req = request(
        url,
        {
          signal: AbortSignal.timeout(15000),
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, addresses);
            else callback(null, address.address, address.family);
          },
          headers: { Accept: 'image/jpeg,image/png,image/webp' },
        },
        (response) => {
          const mime =
            response.headers['content-type']?.split(';')[0]?.trim() ?? '';
          if (
            response.statusCode !== 200 ||
            Number(response.headers['content-length']) > MAX_IMAGE_BYTES ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(mime)
          ) {
            response.destroy();
            reject(new Error('Image request failed'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_IMAGE_BYTES)
              response.destroy(new Error('Invalid image size'));
            else chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              resolveImage({
                bytes: validateImage(Buffer.concat(chunks), mime),
                mime,
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    },
  ).catch(async (error: unknown) => {
    // Validation and HTTP failures never trigger another access path.
    if (
      !(error instanceof Error) ||
      !['ABORT_ERR', 'ECONNRESET', 'ETIMEDOUT'].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    )
      throw error;
    const image = await fetchImageRanges(url, addresses);
    return { bytes: validateImage(image.bytes, image.mime), mime: image.mime };
  });
}
export async function storeImage(bytes: Uint8Array, mime: string) {
  const validated = validateImage(bytes, mime);
  const hash = createHash('sha256').update(validated).digest('hex');
  const directory = resolve(readServerEnv().UPLOADS_DIR, 'nutrition-private');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(resolve(directory, hash), validated, {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return { storageKey: hash, contentHash: hash };
}
export async function readImage(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid image key');
  return readFile(
    resolve(readServerEnv().UPLOADS_DIR, 'nutrition-private', key),
  );
}
