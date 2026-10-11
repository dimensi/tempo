// Injected only by connection-ui.test.ts into its disposable Next.js child process.
// Mock the OAuth wire response; the actual vendored SDK still performs the exchange.
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
      body.username !== 'synthetic-yazio@example.test' ||
      body.password !== 'Synthetic-YAZIO-password-only'
    )
      return Response.json({ error: 'synthetic rejection' }, { status: 401 });
    return Response.json({
      token_type: 'Bearer',
      access_token: 'synthetic-ui-access-only',
      refresh_token: 'synthetic-ui-refresh-only',
      expires_in: 3600,
    });
  }
  if (url.hostname.endsWith('.yazio.com') || url.hostname === 'yazio.com')
    return Response.json(
      { error: 'unexpected synthetic upstream call' },
      { status: 502 },
    );
  return originalFetch(input, init);
};
