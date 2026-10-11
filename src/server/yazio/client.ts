import 'server-only';
import { Yazio } from '@dimensi/yazio';
import type { Token } from '@dimensi/yazio/auth';
import { z } from 'zod';
// Use the library's confirmed token format. Nutrition and photo mappings remain pending research.
export const tokenSchema = z.object({
  token_type: z.string(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number(),
  expires_at: z.number(),
});
export interface YazioTokenStore {
  load(): Promise<Token | null>;
  save(token: Token): Promise<void>;
}
export class YazioIntegrationError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'UPSTREAM_FAILURE') {
    super(
      code === 'NOT_CONFIGURED'
        ? 'YAZIO connection is not configured'
        : 'YAZIO request failed',
    );
  }
}
export async function createYazioClient(store: YazioTokenStore) {
  const token = await store.load();
  if (!token) throw new YazioIntegrationError('NOT_CONFIGURED');
  return new Yazio({
    token: tokenSchema.parse(token),
    onRefresh: ({ token: refreshed }: { token: Token }) =>
      store.save(tokenSchema.parse(refreshed)),
  });
}
export async function yazioRequest<T>(operation: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('YAZIO request timeout')),
          30000,
        );
      }),
    ]);
  } catch {
    throw new YazioIntegrationError('UPSTREAM_FAILURE');
  } finally {
    clearTimeout(timeout);
  }
}
