import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  CI_SYNTHETIC_PROVIDER: 'transformmate',
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'https://localhost:3160',
  TRANSFORMMATE_TOKEN_FILE: './.data/e2e-transformmate-token.json',
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
};
const run = (overrides, code = '') =>
  spawnSync(
    process.execPath,
    ['--require', './tests/transformmate-sync/fetch-preload.cjs', '-e', code],
    { env: { ...env, ...overrides }, encoding: 'utf8' },
  );
test('synthetic production preload admits only exact disposable configuration', () => {
  assert.equal(run({}).status, 0);
  for (const port of [3260, 3262, 3264, 3266, 3268, 3290])
    assert.equal(
      run({ BETTER_AUTH_URL: `https://localhost:${port}` }).status,
      0,
    );
  for (const overrides of [
    { NODE_ENV: 'development' },
    { CI_SYNTHETIC_PROVIDER: '' },
    { DATABASE_URL: 'file:./.data/production.sqlite' },
    { BETTER_AUTH_URL: 'https://nutrition.dimensi.dev' },
    { BETTER_AUTH_URL: 'https://localhost:3292' },
    { BETTER_AUTH_URL: 'https://localhost:3260/private' },
    { TRANSFORMMATE_TOKEN_FILE: '/tmp/real-token.json' },
    { TRANSFORMMATE_FIREBASE_REFRESH_TOKEN: 'real' },
  ])
    assert.notEqual(run(overrides).status, 0);
});
test('synthetic production preload forbids external traffic and nonfixture credentials', () => {
  for (const code of [
    "fetch('https://example.com')",
    "fetch('https://transformmate.pht.space/ipt/api/v1/users/me/', {headers:{authorization:'JWT real'}})",
    "fetch('https://securetoken.googleapis.com/v1/token?key=real', {method:'POST',body:'refresh_token=real'})",
  ])
    assert.notEqual(run({}, code).status, 0);
});
test('only exact two synthetic preview GET paths omit JWT; real API, query, credentials and method still require it', () => {
  const code = `
    import assert from 'node:assert/strict';
    const forwarded = [];
    globalThis.fetch = async input => { forwarded.push(String(input)); return new Response('synthetic'); };
    await import('./tests/transformmate-sync/fetch-preload.cjs');
    for (const name of ['old', 'new']) await fetch('https://transformmate.pht.space/synthetic-preview/' + name + '.png');
    assert.deepEqual(forwarded, ['http://127.0.0.1:3158/transformmate/synthetic-preview/old.png', 'http://127.0.0.1:3158/transformmate/synthetic-preview/new.png']);
    for (const [url, init] of [
      ['https://transformmate.pht.space/ipt/api/v1/exercises/501/'],
      ['https://transformmate.pht.space/synthetic-preview/old.png?secret=real'],
      ['https://user:secret@transformmate.pht.space/synthetic-preview/new.png'],
      ['https://transformmate.pht.space/synthetic-preview/new.png', {method:'POST'}],
      ['https://example.com/synthetic-preview/new.png']
    ]) await assert.rejects(fetch(url, init));
    assert.equal(forwarded.length, 2);
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', code],
    { env, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('each synthetic worker forwards to its own loopback upstream', () => {
  for (let slot = 0; slot < 16; slot++) {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      let forwarded;
      globalThis.fetch = async input => { forwarded = String(input); return new Response('fixture'); };
      await import('./tests/transformmate-sync/fetch-preload.cjs');
      await fetch('https://transformmate.pht.space/synthetic-preview/new.png');
      assert.equal(forwarded, 'http://127.0.0.1:${3360 + slot}/transformmate/synthetic-preview/new.png');
    `,
      ],
      {
        env: {
          ...env,
          BETTER_AUTH_URL: `https://localhost:${3260 + slot * 2}`,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});
