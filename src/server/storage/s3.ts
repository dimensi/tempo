import 'server-only';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { MAX_OBJECT_BYTES, validateObjectKey } from './keys';

// S3-совместимое хранилище (SeaweedFS на NAS): path-style, приватный бакет.
// Ключ проверяется на каждом вызове: реализация не доверяет вызывающему.
export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3ObjectStorage(config: S3StorageConfig) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return {
    async put(
      key: string,
      bytes: Uint8Array,
      contentType?: string,
    ): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: validateObjectKey(key),
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },
    async get(key: string): Promise<Uint8Array> {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: validateObjectKey(key),
        }),
      );
      const stream = output.Body;
      if (!stream) throw new Error('Empty storage object');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > MAX_OBJECT_BYTES)
          throw new Error('Storage object too large');
        chunks.push(chunk);
      }
      return new Uint8Array(Buffer.concat(chunks));
    },
    async putStream(
      key: string,
      body: AsyncIterable<Uint8Array>,
      size: number,
      contentType: string,
    ) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: validateObjectKey(key),
          Body: Readable.from(
            (async function* () {
              let bytes = 0;
              for await (const chunk of body) {
                bytes += chunk.length;
                if (bytes > size) throw new Error('Storage size mismatch');
                yield chunk;
              }
              if (bytes !== size) throw new Error('Storage size mismatch');
            })(),
          ),
          ContentLength: size,
          ContentType: contentType,
        }),
      );
    },
    async readStream(key: string, range?: { start: number; end: number }) {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: validateObjectKey(key),
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      if (!output.Body) throw new Error('Empty storage object');
      return {
        body: output.Body.transformToWebStream(),
        size: output.ContentLength ?? 0,
      };
    },
    async remove(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: validateObjectKey(key),
        }),
      );
    },
  };
}
