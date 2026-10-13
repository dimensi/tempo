// Injected only by connection-ui.test.ts into its disposable Next.js child process.
// Mock the OAuth wire response; the actual vendored SDK still performs the exchange.
const expected = {
  BETTER_AUTH_URL: 'https://localhost:3160',
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
};
if (
  process.env.NODE_ENV !== 'production' ||
  process.env.CI_SYNTHETIC_PROVIDER !== 'yazio'
)
  throw new Error(
    'Only isolated synthetic production YAZIO tests may load this fixture',
  );
for (const [key, value] of Object.entries(expected))
  if (process.env[key] !== value)
    throw new Error('Unsafe synthetic YAZIO environment');
const root = process.cwd();
if (
  !['file:./.data/e2e.sqlite', `file:${root}/.data/e2e.sqlite`].includes(
    process.env.DATABASE_URL,
  )
)
  throw new Error('Only the disposable E2E database is allowed');
if (
  process.env.YAZIO_TOKEN_FILE !== `${root}/.data/e2e-yazio-connection.json` &&
  !(
    process.env.YAZIO_TOKEN_FILE === '' &&
    process.env.CI_YAZIO_UNCONFIGURED === 'true'
  )
)
  throw new Error('Only the disposable YAZIO token store is allowed');
if (process.env.YAZIO_ACCESS_TOKEN || process.env.YAZIO_REFRESH_TOKEN)
  throw new Error('Inherited provider credentials forbidden');
let initialFailuresRemaining = 0;
let backfillDelay = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url,
  );
  if (
    url.hostname === 'yzapi.yazio.com' &&
    url.pathname === '/v22/oauth/token'
  ) {
    const body = JSON.parse(init?.body ?? '{}');
    if (
      ![
        'synthetic-yazio@example.test',
        'synthetic-fail-sync@example.test',
        'synthetic-close-browser@example.test',
      ].includes(body.username) ||
      body.password !== 'Synthetic-YAZIO-password-only'
    )
      return Response.json({ error: 'synthetic rejection' }, { status: 401 });
    backfillDelay =
      body.username === 'synthetic-close-browser@example.test' ? 500 : 0;
    initialFailuresRemaining =
      body.username === 'synthetic-fail-sync@example.test' ? 12 : 0;
    return Response.json({
      token_type: 'Bearer',
      access_token: 'synthetic-ui-access-only',
      refresh_token: 'synthetic-ui-refresh-only',
      expires_in: 3600,
    });
  }
  if (url.hostname === 'yzapi.yazio.com') {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.get('authorization') !== 'Bearer synthetic-ui-access-only')
      throw new Error('Only synthetic YAZIO authorization is allowed');
    if (url.pathname.endsWith('/user'))
      return Response.json({
        email: 'synthetic-yazio@example.test',
        first_name: 'Synthetic',
        last_name: 'YAZIO',
        profile_image: 'https://images.yazio-cdn.com/synthetic-avatar.png',
        user_token: 'synthetic-private-profile-token',
      });
    if (
      initialFailuresRemaining > 0 &&
      (url.pathname.endsWith('/user/consumed-items') ||
        url.pathname.endsWith('/user/widgets/daily-summary') ||
        url.pathname.includes('/user/meal-images/'))
    ) {
      initialFailuresRemaining--;
      return Response.json(
        { error: 'synthetic initial loading failure' },
        { status: 502 },
      );
    }
    if (url.pathname.endsWith('/user/consumed-items')) {
      if (backfillDelay)
        await new Promise((resolve) => setTimeout(resolve, backfillDelay));
      return Response.json({
        products: [],
        recipe_portions: [],
        simple_products: [],
      });
    }
    if (url.pathname.endsWith('/user/widgets/daily-summary'))
      return Response.json({
        meals: Object.fromEntries(
          ['breakfast', 'lunch', 'dinner', 'snack'].map((meal) => [
            meal,
            { nutrients: {} },
          ]),
        ),
      });
    if (url.pathname.includes('/user/meal-images/')) return Response.json({});
  }
  if (url.hostname.endsWith('.yazio.com') || url.hostname === 'yazio.com')
    return Response.json(
      { error: 'unexpected synthetic upstream call' },
      { status: 502 },
    );
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('External network forbidden in synthetic YAZIO runtime');
  return originalFetch(input, init);
};
