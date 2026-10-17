import 'server-only';
import type { CatalogIdentity } from './catalog-store';
import { replicaStore } from './replica-store';
import { FirebaseRefreshError, TransformMateApiError } from './errors';
export class ReplicaUnavailable extends Error {
  constructor() {
    super('Catalog temporarily unavailable');
  }
}
export class ReplicaStorageError extends Error {
  constructor() {
    super('Replica storage unavailable');
  }
}
export class ReplicaMediaError extends Error {
  constructor() {
    super('Invalid replica media');
  }
}
export function allowReplicaUpstream(scope: CatalogIdentity, now = Date.now()) {
  const state = replicaStore().state(scope);
  if (
    state.reason === 'auth' ||
    (state.reason !== 'storage' && state.blocked_until > now) ||
    state.next_request_at > now
  )
    throw new ReplicaUnavailable();
}
export function recordReplicaFailure(
  scope: CatalogIdentity,
  error: unknown,
  now = Date.now(),
) {
  if (error instanceof ReplicaUnavailable) return;
  const store = replicaStore(),
    state = store.state(scope);
  const auth =
    (error instanceof FirebaseRefreshError &&
      [400, 401, 403].includes(error.status ?? 0)) ||
    (error instanceof TransformMateApiError &&
      [401, 403].includes(error.status));
  const global =
    auth ||
    error instanceof ReplicaStorageError ||
    error instanceof FirebaseRefreshError ||
    (error instanceof TransformMateApiError &&
      (error.status === 429 || error.status >= 500)) ||
    !(
      error instanceof TransformMateApiError ||
      error instanceof ReplicaMediaError
    );
  if (!global) return;
  if (
    state.blocked_until > now &&
    state.reason &&
    !auth &&
    !(error instanceof ReplicaStorageError)
  )
    return;
  const failures = Math.min(state.failures + 1, 20);
  const delay = Math.min(
    21600000,
    60000 * 2 ** (failures - 1) * (1 + Math.random() * 0.2),
  );
  const retry =
    error instanceof TransformMateApiError && error.status === 429
      ? (error.retryAfterMs ?? 0)
      : 0;
  store.patch(scope, {
    failures,
    reason: auth
      ? 'auth'
      : error instanceof ReplicaStorageError
        ? 'storage'
        : 'upstream',
    blocked_until: now + Math.max(delay, retry),
  });
}
export async function replicaRequest<T>(
  scope: CatalogIdentity,
  work: () => Promise<T>,
) {
  allowReplicaUpstream(scope);
  replicaStore().patch(scope, {
    next_request_at: Date.now() + 6000 + Math.floor(Math.random() * 3001),
  });
  try {
    return await work();
  } catch (error) {
    recordReplicaFailure(scope, error);
    throw error;
  }
}

// Playback ranges share outage backoff but are not background enrichment jobs.
// Seeking must not wait six seconds between byte ranges.
export async function replicaMediaRequest(
  scope: CatalogIdentity,
  work: () => Promise<Response>,
) {
  const state = replicaStore().state(scope);
  if (
    state.reason === 'auth' ||
    (state.reason !== 'storage' && state.blocked_until > Date.now())
  )
    throw new ReplicaUnavailable();
  try {
    const response = await work();
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      const retry = response.headers.get('retry-after');
      const retryAfterMs =
        retry && /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : retry
            ? Math.max(0, Date.parse(retry) - Date.now())
            : undefined;
      throw new TransformMateApiError({
        status: response.status,
        statusText: '',
        isJson: false,
        body: null,
        contentType: '',
        retryAfterMs,
      });
    }
    return response;
  } catch (error) {
    recordReplicaFailure(scope, error);
    throw error;
  }
}
