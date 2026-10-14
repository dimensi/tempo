import 'server-only';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MAX_OBJECT_BYTES, validateObjectKey } from './keys';

// Локальная реализация объектного хранилища: разработка и E2E без NAS.
// Ключ проверяется на каждом вызове: реализация не доверяет вызывающему.
export interface FsStorageConfig {
  rootDir: string;
}

export function fsObjectStorage(config: FsStorageConfig) {
  const root = resolve(config.rootDir, 'object-storage');
  const path = (key: string) => resolve(root, validateObjectKey(key));
  return {
    async put(key: string, bytes: Uint8Array): Promise<void> {
      const target = path(key);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // put идемпотентен и перезаписывает: как S3 PutObject.
      await writeFile(target, bytes, { mode: 0o600 });
    },
    async get(key: string): Promise<Uint8Array> {
      const target = path(key);
      const { stat } = await import('node:fs/promises');
      const info = await stat(target);
      if (info.size > MAX_OBJECT_BYTES)
        throw new Error('Storage object too large');
      return new Uint8Array(await readFile(target));
    },
    async putStream(
      key: string,
      body: AsyncIterable<Uint8Array>,
      size: number,
      contentType: string,
    ) {
      void contentType;
      const target = path(key);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      let count = 0;
      async function* bounded() {
        for await (const chunk of body) {
          count += chunk.byteLength;
          if (count > size) throw new Error('Storage size mismatch');
          yield chunk;
        }
        if (count !== size) throw new Error('Storage size mismatch');
      }
      const temporary = `${target}.upload`;
      try {
        await pipeline(
          Readable.from(bounded()),
          createWriteStream(temporary, { mode: 0o600 }),
        );
        const { rename } = await import('node:fs/promises');
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async readStream(key: string, range?: { start: number; end: number }) {
      const target = path(key);
      const { stat } = await import('node:fs/promises');
      const info = await stat(target);
      return {
        body: Readable.toWeb(
          createReadStream(target, range),
        ) as ReadableStream<Uint8Array>,
        size: info.size,
      };
    },
    async remove(key: string): Promise<void> {
      await rm(path(key), { force: true });
    },
  };
}
