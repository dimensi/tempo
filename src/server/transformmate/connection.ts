import 'server-only';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { workoutTransformMateLinks } from '@/server/db/schema/transformmate';
import {
  transformMateCredentialsSchema,
  type TransformMateConnectionStatus,
} from '@/contracts/transformmate-connection';
import {
  configuredTransformMateStore,
  getTransformMateClient,
  invalidateTransformMateClient,
} from './runtime';
import { FirebaseSession } from './firebase-session';
import { createTransformMateClient } from './client';
import { readTransformMateAccount } from './account';
import { FirebaseRefreshError, TransformMateApiError } from './errors';
import {
  TransformMateStorageError,
  TransformMateStaleConnectionError,
} from './token-store';

export class TransformMateConnectionAccessError extends Error {
  constructor(public readonly status: number) {
    super('TransformMate access denied');
  }
}
export class TransformMateAccountBindingError extends Error {
  constructor() {
    super('TransformMate account binding mismatch');
  }
}
export async function transformMateOwner(headers: Headers) {
  const access = await authorize(headers, 'transformmate:manage');
  if (!access.ok) throw new TransformMateConnectionAccessError(access.status);
  const ownerId = access.session.user.id;
  const scoped = await authorize(headers, 'transformmate:manage', ownerId);
  if (!scoped.ok) throw new TransformMateConnectionAccessError(scoped.status);
  return ownerId;
}
async function recheck(headers: Headers, ownerId: string) {
  if ((await transformMateOwner(headers)) !== ownerId)
    throw new TransformMateConnectionAccessError(403);
}
function status(
  state: Awaited<
    ReturnType<ReturnType<typeof configuredTransformMateStore>['load']>
  >,
  errorCode: TransformMateConnectionStatus['errorCode'] = null,
): TransformMateConnectionStatus {
  return {
    configured: Boolean(state.token),
    account: state.token?.account ?? null,
    checkedAt: state.token?.checkedAt ?? null,
    errorCode,
  };
}
export function connectionErrorCode(
  error: unknown,
): NonNullable<TransformMateConnectionStatus['errorCode']> {
  if (error instanceof TransformMateStorageError) return 'storage_error';
  if (
    (error instanceof FirebaseRefreshError &&
      (error.status === 400 ||
        error.status === 401 ||
        error.code === 'PERSISTENCE_CALLBACK_FAILED')) ||
    (error instanceof TransformMateApiError &&
      [401, 403].includes(error.status))
  )
    return 'reauth_required';
  return 'upstream_error';
}
export async function getTransformMateStatus(
  headers: Headers,
): Promise<TransformMateConnectionStatus> {
  const ownerId = await transformMateOwner(headers);
  try {
    const state = await configuredTransformMateStore(ownerId).load();
    await recheck(headers, ownerId);
    return status(state);
  } catch (error) {
    if (error instanceof TransformMateConnectionAccessError) throw error;
    await recheck(headers, ownerId);
    return {
      configured: false,
      account: null,
      checkedAt: null,
      errorCode: 'storage_error',
    };
  }
}
export async function connectTransformMate(headers: Headers, input: unknown) {
  const ownerId = await transformMateOwner(headers);
  const credentials = transformMateCredentialsSchema.parse(input);
  const store = configuredTransformMateStore(ownerId);
  const previous = await store.load();
  const session = new FirebaseSession({
    firebaseApiKey: credentials.apiKey,
    refreshToken: credentials.refreshToken,
  });
  const client = createTransformMateClient({
    baseUrl: 'https://transformmate.pht.space/ipt/api/v1',
    tokenProvider: session,
  });
  const account = await readTransformMateAccount(client);
  const info = session.getSessionInfo();
  if (!info || !info.userId || !info.projectId)
    throw new Error('Invalid TransformMate session');
  await recheck(headers, ownerId);
  const hasLinks = getDatabase()
    .db.select({
      remoteTrainingId: workoutTransformMateLinks.remoteTrainingId,
      state: workoutTransformMateLinks.state,
    })
    .from(workoutTransformMateLinks)
    .where(eq(workoutTransformMateLinks.ownerId, ownerId))
    .all()
    .some((link) => {
      if (link.remoteTrainingId !== null) return true;
      try {
        return JSON.parse(link.state).attempted !== false;
      } catch {
        return true;
      }
    });
  // Existing links carry no provider account ID. Never attach them to an unproven identity.
  if (
    hasLinks &&
    (!previous.binding ||
      previous.binding.account.id !== account.id ||
      previous.binding.userId !== info.userId ||
      previous.binding.projectId !== info.projectId)
  )
    throw new TransformMateAccountBindingError();
  const token = {
    ...credentials,
    refreshToken: session.getRefreshToken(),
    userId: info.userId,
    projectId: info.projectId,
    account,
    checkedAt: new Date().toISOString(),
    connectionId: randomUUID(),
  };
  await recheck(headers, ownerId);
  await store.save(token);
  invalidateTransformMateClient(ownerId);
  await recheck(headers, ownerId);
  const snapshot = status(await store.load());
  await recheck(headers, ownerId);
  return snapshot;
}
export async function checkTransformMate(headers: Headers, input: unknown) {
  const ownerId = await transformMateOwner(headers);
  z.object({}).strict().parse(input);
  const store = configuredTransformMateStore(ownerId);
  const previous = await store.load();
  if (!previous.token) {
    await recheck(headers, ownerId);
    return status(previous);
  }
  try {
    const client = await getTransformMateClient(ownerId);
    if (!client) throw new TransformMateStaleConnectionError();
    const account = await readTransformMateAccount(client);
    await recheck(headers, ownerId);
    // Runtime may have atomically rotated credentials; reload only after verifying the stable connection identity.
    const current = await store.load();
    if (
      !current.token ||
      current.token.connectionId !== previous.token.connectionId
    )
      throw new TransformMateStaleConnectionError();
    if (account.id !== current.token.account.id)
      throw new TransformMateAccountBindingError();
    await store.save({
      ...current.token,
      account,
      checkedAt: new Date().toISOString(),
    });
    invalidateTransformMateClient(ownerId);
    await recheck(headers, ownerId);
    const snapshot = status(await store.load());
    await recheck(headers, ownerId);
    return snapshot;
  } catch (error) {
    if (
      error instanceof TransformMateConnectionAccessError ||
      error instanceof TransformMateStaleConnectionError ||
      error instanceof TransformMateAccountBindingError
    )
      throw error;
    await recheck(headers, ownerId);
    const current = await configuredTransformMateStore(ownerId).load();
    if (current.token?.connectionId !== previous.token.connectionId)
      throw new TransformMateStaleConnectionError();
    const snapshot = status(current, connectionErrorCode(error));
    await recheck(headers, ownerId);
    return snapshot;
  }
}
export async function disconnectTransformMate(
  headers: Headers,
  input: unknown,
) {
  const ownerId = await transformMateOwner(headers);
  z.object({}).strict().parse(input);
  const store = configuredTransformMateStore(ownerId);
  await store.load();
  await recheck(headers, ownerId);
  await store.disconnect();
  invalidateTransformMateClient(ownerId);
  await recheck(headers, ownerId);
  const snapshot = status(await store.load());
  await recheck(headers, ownerId);
  return snapshot;
}
