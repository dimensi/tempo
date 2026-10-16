import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';

const suites = {
  smoke: 'playwright.config.ts',
  nutrition: 'tests/nutrition-sync/e2e.config.ts',
};
const [requested, ...playwrightArgs] = process.argv.slice(2);
if (requested && !(requested in suites))
  throw new Error(
    'Usage: pnpm test:e2e [smoke|nutrition] [Playwright options]',
  );

const lock = '.data/e2e.lock';
mkdirSync('.data', { recursive: true });
try {
  mkdirSync(lock);
} catch (error) {
  if (error.code === 'EEXIST')
    throw new Error(
      'Another E2E run owns .data/e2e.sqlite; wait for it instead of sharing test data.',
    );
  throw error;
}
const release = () => rmSync(lock, { recursive: true, force: true });
process.once('exit', release);

const available = (port) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });

try {
  let gateway;
  for (let port = 3260; port <= 3290; port += 2)
    if ((await available(port)) && (await available(port + 1))) {
      gateway = port;
      break;
    }
  if (!gateway)
    throw new Error(
      'Need one free local E2E gateway/backend port pair; do not stop unrelated processes.',
    );

  const environment = {
    ...process.env,
    CI_E2E_ORIGIN: `https://localhost:${gateway}`,
    CI_E2E_BACKEND_PORT: String(gateway + 1),
  };
  for (const config of Object.values(
    requested ? { [requested]: suites[requested] } : suites,
  )) {
    const result = spawnSync(
      'pnpm',
      ['exec', 'playwright', 'test', '--config', config, ...playwrightArgs],
      { env: environment, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  release();
}
