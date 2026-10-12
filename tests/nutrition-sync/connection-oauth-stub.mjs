// Injected only by connection-ui.test.ts into its disposable Next.js child process.
// Mock the OAuth wire response; the actual vendored SDK still performs the exchange.
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
  return originalFetch(input, init);
};
