// Loaded only in the disposable Next child, never in production.
const expected = {
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'http://localhost:3157',
  TRANSFORMMATE_TOKEN_FILE: './.data/e2e-transformmate-token.json',
  BETTER_AUTH_SECRET: 'transformmate-e2e-only-secret-123456789012345',
};
if (process.env.NODE_ENV === 'production')
  throw new Error('Synthetic preload cannot run in production');
if (
  process.env.TRANSFORMMATE_FIREBASE_API_KEY ||
  process.env.TRANSFORMMATE_FIREBASE_REFRESH_TOKEN
)
  throw new Error(
    'Synthetic runtime requires the encrypted user-entered store',
  );
for (const [key, value] of Object.entries(expected)) {
  if (process.env[key] !== value)
    throw new Error('Unsafe synthetic runtime environment');
}
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const origins = new Map([
    ['https://transformmate.pht.space', '/transformmate'],
    ['https://securetoken.googleapis.com', '/firebase'],
    ['https://kinescopecdn.net', '/media'],
  ]);
  const prefix = origins.get(url.origin);
  if (prefix) {
    if (url.origin === 'https://securetoken.googleapis.com') {
      const body =
        init?.body ??
        (input instanceof Request ? await input.clone().text() : '');
      const parameters = new URLSearchParams(String(body));
      const refreshTokens = new Set([
        'synthetic-refresh-token',
        'synthetic-refresh-token-rotated',
        'synthetic-refresh-token-other',
        'synthetic-refresh-token-rejected',
      ]);
      if (
        url.pathname !== '/v1/token' ||
        url.searchParams.size !== 1 ||
        url.searchParams.get('key') !== 'synthetic-api-key' ||
        parameters.size !== 2 ||
        parameters.get('grant_type') !== 'refresh_token' ||
        !refreshTokens.has(parameters.get('refresh_token'))
      )
        throw new Error('Only exact synthetic browser credentials are allowed');
    }
    if (url.origin === 'https://transformmate.pht.space') {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (
        !['JWT synthetic-id-token', 'JWT synthetic-id-token-other'].includes(
          headers.get('authorization'),
        )
      )
        throw new Error(
          'Only exact synthetic provider authorization is allowed',
        );
    }
    const target = new URL(
      `http://127.0.0.1:3158${prefix}${url.pathname}${url.search}`,
    );
    return original(
      input instanceof Request ? new Request(target, input) : target,
      init,
    );
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('External network forbidden in synthetic runtime');
  return original(input, init);
};
