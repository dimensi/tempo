import 'server-only';
import { createHash } from 'node:crypto';
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

function accountScope(
  ownerId: string,
  binding: {
    account: { id: number };
    userId: string;
    projectId: string;
  },
) {
  const hash = createHash('sha256');
  for (const value of [
    ownerId,
    String(binding.account.id),
    binding.userId,
    binding.projectId,
  ]) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    hash.update(length).update(bytes);
  }
  return hash.digest('hex');
}
export function invalidateTransformMateClient(ownerId: string) {
  clients.delete(ownerId);
}
export async function isTransformMateConfigured(
  ownerId: string,
): Promise<boolean> {
  return Boolean((await configuredTransformMateStore(ownerId).load()).token);
}
const pendingClients = new Map<string, Promise<TransformMateClient | null>>();
export function getTransformMateClient(
  ownerId: string,
): Promise<TransformMateClient | null> {
  const pending = pendingClients.get(ownerId);
  if (pending) return pending;
  const operation = loadTransformMateClient(ownerId);
  pendingClients.set(ownerId, operation);
  void operation
    .finally(() => {
      if (pendingClients.get(ownerId) === operation)
        pendingClients.delete(ownerId);
    })
    .catch(() => {});
  return operation;
}
async function loadTransformMateClient(
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
  const client = await getTransformMateClient(ownerId);
  if (!client) return null;
  const entry = clients.get(ownerId);
  if (!entry || entry.client !== client)
    throw new TransformMateStaleConnectionError();
  const bindingRevision = entry.store.bindingRevision();
  await entry.store.assertCurrent();
  entry.store.assertBindingRevision(bindingRevision);
  if (clients.get(ownerId) !== entry)
    throw new TransformMateStaleConnectionError();
  return {
    client: entry.client,
    generation: entry.token.connectionId,
    authorId: entry.token.account.id,
    accountScope: accountScope(ownerId, entry.token),
    assertCurrent: () => entry.store.assertCurrent(),
    assertBindingCurrent: () =>
      entry.store.assertBindingRevision(bindingRevision),
  };
}

/** Binding-only fence also exposes cached history while disconnected. */
export async function getTransformMateBindingFence(ownerId: string) {
  const store = configuredTransformMateStore(ownerId);
  const bindingRevision = store.bindingRevision();
  const state = await store.load();
  store.assertBindingRevision(bindingRevision);
  return {
    configured: Boolean(state.token),
    accountScope: state.binding ? accountScope(ownerId, state.binding) : null,
    assertCurrent: () => store.assertLoadedCurrent(),
    assertBindingCurrent: () => store.assertBindingRevision(bindingRevision),
  };
}

/** Persistent catalog reads depend on account identity, not token-file rotations. */
export async function getTransformMateCatalogBindingFence(ownerId: string) {
  const store = configuredTransformMateStore(ownerId);
  const revision = store.bindingRevision();
  const initial = await store.load();
  const identity = initial.binding
    ? accountScope(ownerId, initial.binding)
    : null;
  store.assertBindingRevision(revision);
  return {
    configured: Boolean(initial.token),
    accountScope: identity,
    assertBindingCurrent: () => store.assertBindingRevision(revision),
    assertCurrent: async () => {
      const current = await store.load();
      if (
        (current.binding ? accountScope(ownerId, current.binding) : null) !==
        identity
      )
        throw new TransformMateStaleConnectionError();
      store.assertBindingRevision(revision);
    },
  };
}
