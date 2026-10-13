import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  CI_SYNTHETIC_PROVIDER: 'yazio',
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'https://localhost:3160',
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
  YAZIO_TOKEN_FILE: `${process.cwd()}/.data/e2e-yazio-connection.json`,
};
const run = (overrides, code = '') =>
  spawnSync(
    process.execPath,
    [
      '--import',
      './tests/nutrition-sync/connection-oauth-stub.mjs',
      '-e',
      code,
    ],
    { env: { ...env, ...overrides }, encoding: 'utf8' },
  );
test('YAZIO OAuth fixture requires isolated production database, origin, secret and token store', () => {
  assert.equal(run({}).status, 0);
  assert.equal(
    run({ YAZIO_TOKEN_FILE: '', CI_YAZIO_UNCONFIGURED: 'true' }).status,
    0,
  );
  for (const overrides of [
    { NODE_ENV: 'development' },
    { CI_SYNTHETIC_PROVIDER: '' },
    { DATABASE_URL: 'file:./.data/production.sqlite' },
    { BETTER_AUTH_URL: 'https://nutrition.dimensi.dev' },
    { BETTER_AUTH_SECRET: 'other' },
    { YAZIO_TOKEN_FILE: '/tmp/real.json' },
    { YAZIO_REFRESH_TOKEN: 'real' },
  ])
    assert.notEqual(run(overrides).status, 0);
});
test('YAZIO OAuth fixture rejects nonfixture bearer tokens and external network', () => {
  for (const code of [
    "fetch('https://example.com')",
    "fetch('https://yzapi.yazio.com/v22/user', {headers:{authorization:'Bearer real'}})",
  ])
    assert.notEqual(run({}, code).status, 0);
  assert.equal(
    run(
      {},
      "fetch('https://yzapi.yazio.com/v22/oauth/token', {method:'POST',body:JSON.stringify({username:'real',password:'real'})}).then(r=>{if(r.status!==401)process.exit(1)})",
    ).status,
    0,
  );
});
