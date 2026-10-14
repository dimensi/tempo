import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateObjectKey } from './keys';

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
      if (info.size > 104857600) throw new Error('Storage object too large');
      return new Uint8Array(await readFile(target));
    },
    async remove(key: string): Promise<void> {
      await rm(path(key), { force: true });
    },
  };
}
