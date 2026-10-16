import { readResponseSchema } from '@/contracts/read-resources';
import { reportNetworkResult } from './network-state';
import { resetSession, sessionGeneration } from './session-state';
let ending: Promise<void> | undefined;
async function performApiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const generation = sessionGeneration();
  let response: Response;
  try {
    response = await fetch(input, init);
    reportNetworkResult(true);
  } catch (error) {
    if (!init?.signal?.aborted) reportNetworkResult(false);
    throw error;
  }
  if (
    (response.status === 401 || response.status === 403) &&
    generation === sessionGeneration()
  ) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const code =
      body && typeof body === 'object' && 'error' in body
        ? body.error
        : undefined;
    if (code === 'AUTH_REQUIRED' || code === 'ACCESS_REVOKED') {
      ending ??= (async () => {
        resetSession();
        const { endClientSession } = await import('./local-logout');
        await endClientSession(false);
        if (navigator.onLine) location.replace('/login');
      })();
      await ending;
    }
  }
  const method =
    init?.method ?? (input instanceof Request ? input.method : 'GET');
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.origin,
  );
  const schema =
    method.toUpperCase() === 'GET' && url.origin === location.origin
      ? readResponseSchema(url.pathname)
      : undefined;
  if (response.ok && schema) {
    const parsed = schema.parse(await response.clone().json());
    if (generation === sessionGeneration()) {
      const { seedClientRead, canonicalReadKey } =
        await import('./client-read');
      await seedClientRead(canonicalReadKey(url), parsed, generation);
    }
    return new Response(JSON.stringify(parsed), {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}

const pending = new Map<string, Promise<Response>>();
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (method !== 'GET') return performApiFetch(input, init);
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  signal?.throwIfAborted();
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.origin,
  );
  url.searchParams.sort();
  const key = `${sessionGeneration()}:${url}:${JSON.stringify([...new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))])}`;
  let flight = pending.get(key);
  if (!flight) {
    flight = performApiFetch(input, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    pending.set(key, flight);
    const done = () => {
      if (pending.get(key) === flight) pending.delete(key);
    };
    void flight.then(done, done);
  }
  const response = await (signal
    ? Promise.race([
        flight,
        new Promise<never>((_, reject) => {
          const abort = () =>
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
          void flight!.then(
            () => signal.removeEventListener('abort', abort),
            () => signal.removeEventListener('abort', abort),
          );
        }),
      ])
    : flight);
  return response.clone();
}
