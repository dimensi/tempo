import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isolatedBrowser } from '../../scripts/ci/isolated-browser.mjs';

test('parallel browser runner cannot silently exceed measured concurrency', async () => {
  for (const concurrency of [0, 5, 8, NaN, 1.5])
    await assert.rejects(
      isolatedBrowser({}, concurrency),
      /concurrency must be between 1 and 4/,
    );
});

test('configurable browser origins admit only dedicated local HTTPS gateways', () => {
  const read = (origin) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "await import('./tests/ci/origin.ts')",
      ],
      {
        env: { ...process.env, CI_E2E_ORIGIN: origin },
        encoding: 'utf8',
      },
    );
  for (const port of [3160, 3260, 3262, 3264, 3266])
    assert.equal(read(`https://localhost:${port}`).status, 0);
  for (const origin of [
    'https://production.example:3260',
    'http://localhost:3260',
    'https://localhost:3000',
    'https://user:password@localhost:3260',
    'https://localhost:3260/private',
    'https://localhost:3260?x=1',
  ])
    assert.notEqual(read(origin).status, 0, origin);
});
