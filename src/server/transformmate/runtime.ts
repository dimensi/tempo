import 'server-only';
import { resolve, sep } from 'node:path';
import { readServerEnv } from '@/server/env';
import { createTransformMateClient, type TransformMateClient } from './client';
import { FirebaseSession } from './firebase-session';
import {
  fileTransformMateTokenStore,
  type TransformMateToken,
  TransformMateStaleConnectionError,
  TransformMateStorageError,
} from './token-store';

export function configuredTransformMateStore(ownerId: string) {
  const env = readServerEnv();
  const path = resolve(env.TRANSFORMMATE_TOKEN_FILE);
  for (const unsafe of [resolve('public'), resolve(env.UPLOADS_DIR)]) {
    if (path === unsafe || path.startsWith(unsafe + sep))
      throw new TransformMateStorageError();
  }
  return fileTransformMateTokenStore(
    path,
    ownerId,
    env.BETTER_AUTH_SECRET ?? '',
  );
}
const clients = new Map<
  string,
  {
    client: TransformMateClient;
    token: TransformMateToken;
    store: ReturnType<typeof configuredTransformMateStore>;
  }
>();
export function invalidateTransformMateClient(ownerId: string) {
  clients.delete(ownerId);
}
export async function isTransformMateConfigured(
  ownerId: string,
): Promise<boolean> {
  return Boolean((await configuredTransformMateStore(ownerId).load()).token);
}
export async function getTransformMateClient(
  ownerId: string,
): Promise<TransformMateClient | null> {
  const cached = clients.get(ownerId);
  if (cached) {
    try {
      await cached.store.assertCurrent();
      return cached.client;
    } catch (error) {
      clients.delete(ownerId);
      if (!(error instanceof TransformMateStaleConnectionError)) throw error;
    }
  }
  const store = configuredTransformMateStore(ownerId);
  const state = await store.load();
  if (!state.token) return null;
  let token = state.token;
  const session = new FirebaseSession({
    firebaseApiKey: token.apiKey,
    refreshToken: token.refreshToken,
    onRefreshToken: async (refreshToken, info) => {
      await store.assertCurrent();
      if (info.userId !== token.userId || info.projectId !== token.projectId)
        throw new Error('TransformMate session identity changed');
      if (refreshToken !== token.refreshToken) {
        const next = { ...token, refreshToken };
        await store.save(next);
        token = next;
      }
      await store.assertCurrent();
    },
  });
  const raw = createTransformMateClient({
    baseUrl: 'https://transformmate.pht.space/ipt/api/v1',
    tokenProvider: {
      redact: session.redact,
      async getIdToken(options) {
        await store.assertCurrent();
        const id = await session.getIdToken(options);
        const info = session.getSessionInfo();
        if (
          !info ||
          info.userId !== token.userId ||
          info.projectId !== token.projectId
        )
          throw new Error('TransformMate session identity changed');
        await store.assertCurrent();
        return id;
      },
    },
    fetch: async (input, init) => {
      await store.assertCurrent();
      const response = await fetch(input, init);
      await store.assertCurrent();
      return response;
    },
  });
  // Covers the full body/validation/multi-request mutation, as well as individual fetches.
  const client = new Proxy(raw, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await store.assertCurrent();
        const result = await value(...args);
        await store.assertCurrent();
        return result;
      };
    },
  });
  await store.assertCurrent();
  clients.set(ownerId, { client, token, store });
  return client;
}
export async function getTransformMateConnectionFence(ownerId: string) {
  if (!(await getTransformMateClient(ownerId))) return null;
  const entry = clients.get(ownerId)!;
  return {
    generation: entry.token.connectionId,
    assertCurrent: () => entry.store.assertCurrent(),
  };
}
