// Loaded only in the disposable Next child, never in production.
const expected = {
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'http://localhost:3157',
  TRANSFORMMATE_FIREBASE_API_KEY: 'synthetic-api-key',
  TRANSFORMMATE_FIREBASE_REFRESH_TOKEN: 'synthetic-refresh-token',
};
if (process.env.NODE_ENV === 'production')
  throw new Error('Synthetic preload cannot run in production');
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
