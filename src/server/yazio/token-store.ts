import 'server-only';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tokenSchema, type YazioTokenStore } from './client';
// Deployment-managed secret file, never a public upload or browser-accessible path.
export function fileTokenStore(path: string): YazioTokenStore {
  return {
    async load() {
      try {
        return tokenSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new Error('Unable to read YAZIO token configuration');
      }
    },
    async save(token) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(tokenSchema.parse(token)), {
        mode: 0o600,
      });
      await rename(temporary, path);
    },
  };
}
