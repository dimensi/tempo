import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(join(process.cwd(), 'package.json'));
const distribution = dirname(require.resolve('@dimensi/yazio'));
const esm = await import(pathToFileURL(join(distribution, 'index.js')).href);
const auth = await import(pathToFileURL(join(distribution, 'auth.js')).href);
const api = await import(pathToFileURL(join(distribution, 'api.js')).href);
const cjs = require('@dimensi/yazio');
const cjsAuth = require('@dimensi/yazio/auth');
const cjsApi = require('@dimensi/yazio/api');
const token = {
  token_type: 'Bearer',
  access_token: 'synthetic-access',
  refresh_token: 'synthetic-refresh',
  expires_in: 3600,
  expires_at: Date.now() + 3600000,
};
assert.equal(esm.YazioAuth, auth.YazioAuth);
assert.equal(cjs.YazioAuth, cjsAuth.YazioAuth);
for (const [root, subpath, raw] of [
  [esm, auth, api],
  [cjs, cjsAuth, cjsApi],
]) {
  const client = new root.Yazio(new subpath.YazioAuth({ token }));
  assert.equal(typeof client.user.getMealImages, 'function');
  assert.equal(typeof client.user.getConsumedItems, 'function');
  assert.equal(typeof client.products.get, 'function');
  assert.equal(typeof raw.getTokenFromCredentials, 'function');
  assert.equal(typeof raw.getTokenFromRefreshToken, 'function');
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      'https://yzapi.yazio.com/v20/user/meal-images/2026-10-10',
    );
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      'Bearer synthetic-access',
    );
    return new Response('{}');
  };
  assert.deepEqual(await client.user.getMealImages({ date: '2026-10-10' }), {});
}
console.log('SDK artifact ESM/CJS/auth/api smoke passed');
