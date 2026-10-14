import 'server-only';
import { readServerEnv } from '@/server/env';
import { fsObjectStorage } from './fs';
import { s3ObjectStorage } from './s3';

// Общее объектное хранилище приложения: анамнесис теперь, загрузки позже.
// Контракт и раскладка ключей — в docs/architecture/object-storage.md.
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  putStream(
    key: string,
    body: AsyncIterable<Uint8Array>,
    size: number,
    contentType: string,
  ): Promise<void>;
  readStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<{ body: ReadableStream<Uint8Array>; size: number }>;
  remove(key: string): Promise<void>;
}

export { validateObjectKey, storageNamespaceKey } from './keys';

function createObjectStorage(
  env: ReturnType<typeof readServerEnv>,
): ObjectStorage {
  if (!env.S3_ENDPOINT) return fsObjectStorage({ rootDir: env.UPLOADS_DIR });
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    throw new Error(
      'S3_ENDPOINT requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    );
  return s3ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
}

const globalStorage = globalThis as unknown as {
  objectStorage?: ObjectStorage;
};

export function getObjectStorage(
  env: ReturnType<typeof readServerEnv> = readServerEnv(),
): ObjectStorage {
  if (!globalStorage.objectStorage)
    globalStorage.objectStorage = createObjectStorage(env);
  return globalStorage.objectStorage;
}
