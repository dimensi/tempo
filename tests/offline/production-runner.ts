import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { request } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';

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
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'https://localhost:3160',
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
  DEMO_MODE: 'false',
  ENABLE_NUTRITION_SCHEDULER: 'false',
  YAZIO_TOKEN_FILE: '',
  TRANSFORMMATE_TOKEN_FILE: resolve('.data/offline-test-transformmate.json'),
  NEXT_TELEMETRY_DISABLED: '1',
};
execFileSync('pnpm', ['exec', 'tsx', 'scripts/prepare-e2e.ts'], {
  env,
  stdio: 'inherit',
});
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  env: { ...env, NODE_ENV: 'production', PORT: '3161', HOSTNAME: '127.0.0.1' },
  stdio: 'inherit',
});
const server = createServer(
  {
    key: readFileSync(`${directory}/key.pem`),
    cert: readFileSync(`${directory}/cert.pem`),
  },
  (incoming, outgoing) => {
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
        port: 3161,
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
server.listen(3160, '127.0.0.1');
function close() {
  child.kill('SIGTERM');
  server.close();
  rmSync(directory, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, close);
child.on('exit', (code) => {
  close();
  process.exit(code ?? 1);
});
