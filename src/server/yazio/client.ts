import 'server-only';
import { Yazio, YazioAuth } from '@dimensi/yazio';
import type { Token } from '@dimensi/yazio/auth';
import { z } from 'zod';
// Use the library's confirmed token format. Nutrition and photo mappings remain pending research.
export const tokenSchema = z.object({
  token_type: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().nonnegative(),
  expires_at: z.number().nonnegative(),
});
export interface YazioTokenStore {
  load(): Promise<Token | null>;
  save(token: Token): Promise<void>;
  assertCurrent?(): Promise<void>;
}
export class YazioIntegrationError extends Error {
  constructor(
    public readonly code: 'NOT_CONFIGURED' | 'UPSTREAM_FAILURE',
    options?: ErrorOptions,
  ) {
    super(
      code === 'NOT_CONFIGURED'
        ? 'YAZIO connection is not configured'
        : 'YAZIO request failed',
      options,
    );
  }
}
export async function createYazioAuth(store: YazioTokenStore) {
  const token = await store.load();
  if (!token) throw new YazioIntegrationError('NOT_CONFIGURED');
  let persistence = Promise.resolve();
  let persistenceFailed = false;
  const auth = new YazioAuth({
    token: tokenSchema.parse(token),
    onRefresh: ({ token: refreshed }: { token: Token }) => {
      // SDK invokes this callback without awaiting it. Handle rejection immediately,
      // then make authenticate wait for persistence before allowing downstream reads.
      persistence = persistence
        .then(() => store.save(tokenSchema.parse(refreshed)))
        .catch(() => {
          persistenceFailed = true;
        });
    },
  });
  const authenticate = auth.authenticate;
  let inFlight: Promise<Token> | undefined;
  auth.authenticate = () => {
    return (inFlight ??= (async () => {
      await store.assertCurrent?.();
      const result = await authenticate();
      await persistence;
      if (persistenceFailed)
        throw new YazioIntegrationError('UPSTREAM_FAILURE');
      await store.assertCurrent?.();
      return result;
    })().finally(() => {
      inFlight = undefined;
    }));
  };
  return auth;
}
export async function createYazioClient(store: YazioTokenStore) {
  return new Yazio(await createYazioAuth(store));
}
export class YazioRequestTimeoutError extends Error {}

export async function yazioRequest<T>(
  operation: () => Promise<T>,
  timeoutMs = 30000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new YazioRequestTimeoutError('YAZIO request timeout')),
          timeoutMs,
        );
      }),
    ]);
  } catch (cause) {
    throw new YazioIntegrationError('UPSTREAM_FAILURE', { cause });
  } finally {
    clearTimeout(timeout);
  }
}
