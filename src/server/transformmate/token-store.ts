import 'server-only';
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  unlink,
  stat,
  chmod,
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

export const transformMateAccountSchema = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    name: z.string().max(300).nullable(),
    email: z.string().max(320).nullable(),
  })
  .strict();
export const transformMateTokenSchema = z
  .object({
    connectionId: z.uuid(),
    apiKey: z.string().trim().min(1).max(512).regex(/^\S+$/),
    refreshToken: z.string().trim().min(1).max(8192).regex(/^\S+$/),
    userId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(256),
    account: transformMateAccountSchema,
    checkedAt: z.iso.datetime(),
  })
  .strict();
export type TransformMateToken = z.infer<typeof transformMateTokenSchema>;
const bindingSchema = z
  .object({
    account: transformMateAccountSchema,
    userId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(256),
  })
  .strict();
const payloadSchema = z
  .object({
    token: transformMateTokenSchema.nullable(),
    binding: bindingSchema.nullable(),
  })
  .strict();
const envelopeSchema = z
  .object({
    version: z.literal(1),
    generation: z.uuid(),
    iv: z.string().max(24),
    tag: z.string().max(32),
    ciphertext: z.string().max(65536),
  })
  .strict();
const writes = new Map<string, Promise<void>>();
// Synchronous, noncredential fence for stable binding changes in this process.
// Ordinary refresh saves retain the binding and do not advance this revision.
const offlineBindingRevisions = new Map<string, number>();
export function transformMateOfflineBindingRevision(file: string) {
  return offlineBindingRevisions.get(resolve(file)) ?? 0;
}
async function serialized<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const result = (writes.get(path) ?? Promise.resolve()).then(operation);
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
export class TransformMateStaleConnectionError extends Error {
  constructor() {
    super('TransformMate connection changed');
  }
}
export class TransformMateStorageError extends Error {
  constructor() {
    super('TransformMate connection storage unavailable');
  }
}
/** One process; every operation carries the generation loaded before its upstream work. */
export function fileTransformMateTokenStore(
  file: string,
  ownerId: string,
  secret: string,
) {
  if (!ownerId || secret.length < 32) throw new TransformMateStorageError();
  const path = resolve(file);
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      'yazio-dashboard/transformmate-token-store/v1',
      `owner:${ownerId}`,
      32,
    ),
  );
  const aad = (generation: string) =>
    Buffer.from(
      JSON.stringify({
        purpose: 'transformmate-token-store',
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
      const iv = Buffer.from(envelope.iv, 'base64'),
        tag = Buffer.from(envelope.tag, 'base64');
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad(envelope.generation));
      decipher.setAuthTag(tag);
      const payload = payloadSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
            decipher.final(),
          ]).toString('utf8'),
        ),
      );
      if (
        payload.token &&
        (payload.binding?.account.id !== payload.token.account.id ||
          payload.binding.userId !== payload.token.userId ||
          payload.binding.projectId !== payload.token.projectId)
      )
        throw new Error();
      return { generation: envelope.generation, ...payload };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { generation: null, token: null, binding: null };
      throw new TransformMateStorageError();
    }
  }
  async function write(payload: z.infer<typeof payloadSchema>) {
    const generation = randomUUID(),
      iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(generation));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload)),
      cipher.final(),
    ]);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await chmod(dirname(path), 0o700);
      await writeFile(
        temporary,
        JSON.stringify({
          version: 1,
          generation,
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          ciphertext: ciphertext.toString('base64'),
        }),
        { mode: 0o600, flag: 'wx' },
      );
      await rename(temporary, path);
      expected = generation;
      loaded = true;
    } catch {
      throw new TransformMateStorageError();
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  function assertGeneration(current: Awaited<ReturnType<typeof read>>) {
    if (!loaded || current.generation !== expected)
      throw new TransformMateStaleConnectionError();
  }
  return {
    async load() {
      return serialized(path, async () => {
        const current = await read();
        expected = current.generation;
        loaded = true;
        return current;
      });
    },
    async assertCurrent() {
      return serialized(path, async () => {
        const current = await read();
        assertGeneration(current);
        if (!current.token) throw new TransformMateStaleConnectionError();
      });
    },
    async offlineBinding() {
      return serialized(path, async () => {
        const current = await read();
        return {
          configured: Boolean(current.token),
          connectionId: current.token?.connectionId ?? null,
          revision: transformMateOfflineBindingRevision(path),
        };
      });
    },
    async save(token: TransformMateToken) {
      const validated = transformMateTokenSchema.parse(token);
      const generation = expected;
      const wasLoaded = loaded;
      return serialized(path, async () => {
        const current = await read();
        if (!wasLoaded || current.generation !== generation)
          throw new TransformMateStaleConnectionError();
        if (current.token?.connectionId !== validated.connectionId)
          offlineBindingRevisions.set(
            path,
            transformMateOfflineBindingRevision(path) + 1,
          );
        await write({
          token: validated,
          binding: {
            account: validated.account,
            userId: validated.userId,
            projectId: validated.projectId,
          },
        });
      });
    },
    async disconnect() {
      const generation = expected;
      const wasLoaded = loaded;
      return serialized(path, async () => {
        const current = await read();
        if (!wasLoaded || current.generation !== generation)
          throw new TransformMateStaleConnectionError();
        if (current.token)
          offlineBindingRevisions.set(
            path,
            transformMateOfflineBindingRevision(path) + 1,
          );
        await write({ token: null, binding: current.binding });
      });
    },
    generation() {
      return expected;
    },
  };
}

// Purpose-limited local metadata read: never construct a client or expose the
// decrypted credential/profile payload. connectionId survives token refresh.
export async function readTransformMateOfflineBinding(
  file: string,
  ownerId: string,
  secret: string,
) {
  return fileTransformMateTokenStore(file, ownerId, secret).offlineBinding();
}
