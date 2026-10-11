import 'server-only';
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  unlink,
  stat,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  randomUUID,
  randomBytes,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { z } from 'zod';
import { tokenSchema, type YazioTokenStore } from './client';
const envelopeSchema = z
  .object({
    version: z.literal(1),
    generation: z.uuid(),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  })
  .strict();
const writes = new Map<string, Promise<void>>();
async function serialized<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = writes.get(path) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => {},
    () => {},
  );
  writes.set(path, tail);
  try {
    return await result;
  } finally {
    if (writes.get(path) === tail) writes.delete(path);
  }
}
export class YazioStaleConnectionError extends Error {
  constructor() {
    super('YAZIO connection changed');
  }
}
export interface EncryptedYazioTokenStore extends YazioTokenStore {
  disconnect(): Promise<void>;
}
// No plaintext fallback. One process serializes writes; loaded generations are CAS guards.
export function fileTokenStore(
  file: string,
  ownerId: string,
  secret: string,
): EncryptedYazioTokenStore {
  if (!ownerId || secret.length < 32)
    throw new Error('YAZIO token encryption is not configured');
  const path = resolve(file);
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      'yazio-dashboard/token-store/v1',
      `owner:${ownerId}`,
      32,
    ),
  );
  const aad = (generation: string) =>
    Buffer.from(
      JSON.stringify({
        context: 'yazio-dashboard/token-store',
        version: 1,
        ownerId,
        generation,
      }),
    );
  let loaded = false;
  let expected: string | null = null;
  async function read() {
    try {
      if ((await stat(path)).size > 65536) throw new Error();
      const envelope = envelopeSchema.parse(
        JSON.parse(await readFile(path, 'utf8')),
      );
      const iv = Buffer.from(envelope.iv, 'base64');
      const tag = Buffer.from(envelope.tag, 'base64');
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad(envelope.generation));
      decipher.setAuthTag(tag);
      const payload = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
          decipher.final(),
        ]).toString(),
      );
      return {
        generation: envelope.generation,
        token: payload === null ? null : tokenSchema.parse(payload),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { generation: null, token: null };
      throw new Error('Unable to read encrypted YAZIO connection');
    }
  }
  async function write(token: z.infer<typeof tokenSchema> | null) {
    const generation = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(generation));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(token)),
      cipher.final(),
    ]);
    const envelope = {
      version: 1,
      generation,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(envelope), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
    expected = generation;
    loaded = true;
  }
  return {
    async assertCurrent() {
      await serialized(path, async () => {
        const current = await read();
        if (!loaded || !current.token || current.generation !== expected)
          throw new YazioStaleConnectionError();
      });
    },
    async load() {
      return serialized(path, async () => {
        const current = await read();
        expected = current.generation;
        loaded = true;
        return current.token;
      });
    },
    async save(token) {
      const validated = tokenSchema.parse(token);
      const wasLoaded = loaded;
      const generation = expected;
      await serialized(path, async () => {
        const current = await read();
        if (wasLoaded && current.generation !== generation)
          throw new YazioStaleConnectionError();
        await write(validated);
      });
    },
    async disconnect() {
      const wasLoaded = loaded;
      const generation = expected;
      await serialized(path, async () => {
        const current = await read();
        if (wasLoaded && current.generation !== generation)
          throw new YazioStaleConnectionError();
        // Authenticated encrypted null invalidates every previously loaded refresh client.
        await write(null);
      });
    },
  };
}
