import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { request } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  appendFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { startUpstream } from '../transformmate-sync/upstream';
import { testOrigin } from '../ci/origin';
import { verifyFixtureSnapshot } from '../ci/fixture-snapshot';
import { serverSnapshot as createServerSnapshot } from '../ci/server-snapshot';
import { stopServer } from '../ci/stop-server';
const family = process.argv[2] ?? 'offline';
const gatewayPort = Number(new URL(testOrigin).port);
const backendPort = Number(process.env.CI_E2E_BACKEND_PORT ?? 3161);
if (backendPort !== gatewayPort + 1)
  throw new Error('E2E backend must match its disposable gateway');
if (
  ![
    'general',
    'isolation',
    'nutrition',
    'nutrition-connection',
    'transformmate',
    'offline',
    'smoke',
  ].includes(family)
)
  throw new Error('Unknown production test family');
if (!existsSync('.next/standalone/server.js'))
  throw new Error('Build once before production tests');

const assets = readdirSync('public/offline/assets').map(
  (file) => `/offline/assets/${file}`,
);
const legacy = (
  await build({
    entryPoints: ['tests/offline/legacy-service-worker.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    tsconfig: 'tsconfig.json',
    define: {
      __OFFLINE_ASSETS__: JSON.stringify([...assets, '/offline/index.html']),
      __OFFLINE_CACHE_NAME__: JSON.stringify('yazio-offline-shell-legacy-test'),
      __OFFLINE_SHELL__: JSON.stringify('/offline/index.html'),
    },
  })
).outputFiles[0]!.text;
let workerMode = 'current';
let navigationStatus = 0;
let holdInstall = false;
const held: (() => void)[] = [];

for (const file of [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
])
  if (existsSync(file))
    throw new Error(
      'Synthetic offline tests require no local environment files',
    );
const directory = mkdtempSync(`${tmpdir()}/yazio-offline-tls-`);
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${directory}/key.pem`,
    '-out',
    `${directory}/cert.pem`,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  YAZIO_BROWSER_PROCESS_TOKEN: process.env.YAZIO_BROWSER_PROCESS_TOKEN,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: `https://localhost:${gatewayPort}`,
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
  DEMO_MODE: 'false',
  ENABLE_NUTRITION_SCHEDULER: 'false',
  YAZIO_TOKEN_FILE:
    family === 'nutrition-connection' &&
    process.env.CI_YAZIO_UNCONFIGURED !== 'true'
      ? resolve('.data/e2e-yazio-connection.json')
      : '',
  TRANSFORMMATE_TOKEN_FILE: resolve('.data/e2e-transformmate-token.json'),
  UPLOADS_DIR: './.data/e2e-nutrition-uploads',
  // E2E-only детерминированное распознавание контрольного PDF анамнеза.
  ANAMNESIS_EXTRACTION_FIXTURE_SHA256: createHash('sha256')
    .update(readFileSync('tests/fixtures/anamnesis/synthetic-lab.pdf'))
    .digest('hex'),
  NEXT_TELEMETRY_DISABLED: '1',
};
rmSync(env.TRANSFORMMATE_TOKEN_FILE!, { force: true });
if (family !== 'nutrition-connection')
  rmSync(env.UPLOADS_DIR!, { force: true, recursive: true });
let upstream = family === 'transformmate' ? await startUpstream() : undefined;
const fixtureHash = process.env.CI_E2E_FIXTURE_SHA256;
if (fixtureHash) verifyFixtureSnapshot(family, fixtureHash);
if (family !== 'nutrition-connection' && !fixtureHash)
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/prepare-e2e.ts'], {
    env,
    stdio: 'inherit',
  });
const isolatedWorker = process.env.CI_E2E_WORKER === 'true';
if (isolatedWorker && !fixtureHash)
  throw new Error('Isolated worker requires a verified fixture');
const fixture = isolatedWorker ? readFileSync('.data/e2e.sqlite') : undefined;
let restarting = false;
let closing = false;
let generation = 0;
const serverSnapshot = resolve('.next/e2e-server-snapshot');
if (isolatedWorker)
  cpSync('.next/standalone/.next/server', serverSnapshot, { recursive: true });
const restoreServer = isolatedWorker
  ? createServerSnapshot(serverSnapshot)
  : undefined;
function startServer(caseKey?: unknown[]) {
  const value = spawn(process.execPath, ['.next/standalone/server.js'], {
    env: {
      ...env,
      DATABASE_URL: `file:${resolve('.data/e2e.sqlite')}`,
      UPLOADS_DIR: resolve(env.UPLOADS_DIR!),
      NODE_ENV: 'production',
      PORT: String(backendPort),
      HOSTNAME: '127.0.0.1',
      ...(family === 'nutrition-connection'
        ? {
            CI_SYNTHETIC_PROVIDER: 'yazio',
            CI_YAZIO_UNCONFIGURED:
              process.env.CI_YAZIO_UNCONFIGURED === 'true' ? 'true' : 'false',
            NODE_OPTIONS: `--import=${resolve('tests/nutrition-sync/connection-oauth-stub.mjs')}`,
          }
        : {}),
      ...(family === 'transformmate'
        ? {
            CI_SYNTHETIC_PROVIDER: 'transformmate',
            NODE_OPTIONS: `--require=${resolve('tests/transformmate-sync/fetch-preload.cjs')}`,
          }
        : {}),
    },
    stdio: 'inherit',
  });
  value.on('spawn', () => {
    mkdirSync('test-results', { recursive: true });
    appendFileSync(
      'test-results/production-starts.jsonl',
      JSON.stringify({
        family,
        generation,
        caseKey,
        at: new Date().toISOString(),
      }) + '\n',
    );
  });
  value.on('exit', (code) => {
    if (value !== child || restarting || closing) return;
    close();
    process.exit(code ?? 1);
  });
  return value;
}
let child = startServer();
async function resetCase(caseKey: unknown[]) {
  if (restarting || closing) throw new Error('Worker reset is unavailable');
  restarting = true;
  const timings: Record<string, number> = {};
  const begin = performance.now();
  let phase = begin;
  const mark = (name: string) => {
    const now = performance.now();
    timings[name] = Number((now - phase).toFixed(3));
    phase = now;
  };
  try {
    await stopServer(child);
    mark('stop');
    if (closing) throw new Error('Worker closing');
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`.data/e2e.sqlite${suffix}`, { force: true });
    writeFileSync('.data/e2e.sqlite', fixture!);
    mark('sqlite');
    rmSync(env.TRANSFORMMATE_TOKEN_FILE!, { force: true });
    rmSync(env.UPLOADS_DIR!, { recursive: true, force: true });
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise<void>((done, reject) =>
        upstream!.close((error) => (error ? reject(error) : done())),
      );
      upstream = await startUpstream();
    }
    mark('filesystem');
    rmSync('.next/standalone/.next/cache', { recursive: true, force: true });
    restoreServer!('.next/standalone/.next/server');
    mark('next');
    workerMode = 'current';
    navigationStatus = 0;
    holdInstall = false;
    held.splice(0).forEach((release) => release());
    generation++;
    child = startServer(caseKey);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !closing) {
      const ready = await new Promise<boolean>((done) => {
        const probe = request(
          { hostname: '127.0.0.1', port: backendPort, path: '/login' },
          (response) => {
            response.resume();
            done(response.statusCode === 200);
          },
        );
        probe.on('error', () => done(false));
        probe.setTimeout(1000, () => {
          probe.destroy();
          done(false);
        });
        probe.end();
      });
      if (ready) {
        mark('start');
        timings.total = Number((performance.now() - begin).toFixed(3));
        appendFileSync(
          'test-results/reset-timings.jsonl',
          JSON.stringify(timings) + '\n',
        );
        return generation;
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('Fresh production server did not become ready');
  } finally {
    restarting = false;
  }
}
const server = createServer(
  {
    key: readFileSync(`${directory}/key.pem`),
    cert: readFileSync(`${directory}/cert.pem`),
  },
  (incoming, outgoing) => {
    if (
      isolatedWorker &&
      incoming.url === '/__offline-test/reset' &&
      incoming.method === 'POST'
    ) {
      let body = '';
      incoming.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) incoming.destroy();
      });
      incoming.on('end', () => {
        let caseKey: unknown[];
        try {
          const parsed = JSON.parse(body).caseKey;
          if (!Array.isArray(parsed) || parsed.length !== 4)
            throw new Error('Invalid isolated case');
          caseKey = parsed;
        } catch {
          outgoing.writeHead(400);
          outgoing.end();
          return;
        }
        void resetCase(caseKey).then(
          (generation) => {
            outgoing.writeHead(200, { 'Content-Type': 'application/json' });
            outgoing.end(JSON.stringify({ generation }));
          },
          (error) => {
            console.error(error);
            outgoing.writeHead(500);
            outgoing.end('Synthetic case reset failed');
          },
        );
      });
      return;
    }
    if (
      incoming.url === '/__offline-test/control' &&
      incoming.method === 'POST'
    ) {
      let body = '';
      incoming.on('data', (chunk) => {
        body += chunk;
      });
      incoming.on('end', () => {
        const input = JSON.parse(body);
        workerMode = input.mode ?? workerMode;
        navigationStatus = input.navigationStatus ?? navigationStatus;
        holdInstall = input.hold ?? holdInstall;
        if (!holdInstall) held.splice(0).forEach((release) => release());
        outgoing.writeHead(200, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify({ held: held.length }));
      });
      return;
    }
    if (incoming.url === '/__offline-test/activity') {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ held: held.length }));
      return;
    }
    if (incoming.url === '/offline-sw.js') {
      outgoing.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
      outgoing.end(
        workerMode === 'legacy'
          ? legacy
          : workerMode === 'broken'
            ? 'throw new Error("Synthetic failed update");'
            : readFileSync('public/offline-sw.js'),
      );
      return;
    }
    if (navigationStatus && incoming.url === '/diary') {
      outgoing.writeHead(navigationStatus, { 'Content-Type': 'text/plain' });
      outgoing.end('Synthetic network HTTP error');
      return;
    }
    if (holdInstall && incoming.url?.startsWith('/offline/')) {
      held.push(() => {
        outgoing.writeHead(200, {
          'Content-Type': incoming.url!.split('?')[0]!.endsWith('.js')
            ? 'application/javascript'
            : incoming.url!.split('?')[0]!.endsWith('.css')
              ? 'text/css'
              : incoming.url!.split('?')[0]!.endsWith('.svg')
                ? 'image/svg+xml'
                : 'text/html',
        });
        outgoing.end(readFileSync(`public${incoming.url!.split('?')[0]}`));
      });
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: backendPort,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      outgoing.writeHead(503);
      outgoing.end();
    });
    incoming.pipe(upstream);
  },
);
server.listen(gatewayPort, '127.0.0.1');
function close() {
  closing = true;
  child.kill('SIGTERM');
  upstream?.close();
  server.close();
  rmSync(directory, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, close);
