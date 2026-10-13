// Loaded only in the disposable production-test child, never in a deployed server.
const expected = {
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'https://localhost:3160',
  TRANSFORMMATE_TOKEN_FILE: './.data/e2e-transformmate-token.json',
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
};
if (
  process.env.NODE_ENV !== 'production' ||
  process.env.CI_SYNTHETIC_PROVIDER !== 'transformmate'
)
  throw new Error(
    'Only the isolated synthetic production runner may load this fixture',
  );
if (
  process.env.TRANSFORMMATE_FIREBASE_API_KEY ||
  process.env.TRANSFORMMATE_FIREBASE_REFRESH_TOKEN
)
  throw new Error(
    'Synthetic runtime requires the encrypted user-entered store',
  );
for (const [key, value] of Object.entries(expected)) {
  if (
    process.env[key] !== value &&
    !(
      ['DATABASE_URL', 'TRANSFORMMATE_TOKEN_FILE'].includes(key) &&
      process.env[key] ===
        (key === 'DATABASE_URL' ? 'file:' : '') +
          `${process.cwd()}/${value.replace(/^file:/, '').replace(/^\.\//, '')}`
    )
  )
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
      const method = String(
        init?.method ?? (input instanceof Request ? input.method : 'GET'),
      ).toUpperCase();
      const syntheticPreview =
        method === 'GET' &&
        !url.username &&
        !url.password &&
        url.search === '' &&
        ['/synthetic-preview/old.png', '/synthetic-preview/new.png'].includes(
          url.pathname,
        );
      if (
        !syntheticPreview &&
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
