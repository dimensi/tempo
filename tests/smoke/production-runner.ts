import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { testBackendPort, testOrigin } from './origin';

const family = process.argv[2];
if (!['smoke', 'nutrition'].includes(family ?? ''))
  throw new Error('Production E2E family must be smoke or nutrition');
if (!existsSync('.next/standalone/server.js'))
  throw new Error('Build once before running production E2E smoke checks');
for (const file of [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
])
  if (existsSync(file))
    throw new Error('Synthetic E2E checks require no local environment files');

let child: ReturnType<typeof spawn> | undefined;
let server: ReturnType<typeof createServer> | undefined;
let directory: string | undefined;
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  child?.kill('SIGTERM');
  server?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);

try {
  directory = mkdtempSync(`${tmpdir()}/yazio-e2e-tls-`);
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
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    DATABASE_URL: 'file:./.data/e2e.sqlite',
    BETTER_AUTH_URL: testOrigin,
    BETTER_AUTH_SECRET: 'e2e-synthetic-secret-at-least-32-characters',
    DEMO_MODE: 'false',
    ENABLE_NUTRITION_SCHEDULER: 'false',
    YAZIO_TOKEN_FILE: '',
    TRANSFORMMATE_TOKEN_FILE: resolve('.data/e2e-transformmate-token.json'),
    UPLOADS_DIR: './.data/e2e-uploads',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  rmSync(environment.TRANSFORMMATE_TOKEN_FILE!, { force: true });
  rmSync(environment.UPLOADS_DIR!, { force: true, recursive: true });
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/prepare-e2e.ts'], {
    env: environment,
    stdio: 'inherit',
  });
  child = spawn(process.execPath, ['.next/standalone/server.js'], {
    env: {
      ...environment,
      DATABASE_URL: `file:${resolve('.data/e2e.sqlite')}`,
      UPLOADS_DIR: resolve(environment.UPLOADS_DIR!),
      NODE_ENV: 'production',
      PORT: String(testBackendPort),
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (!closing) {
      close();
      process.exit(code ?? 1);
    }
  });
  server = createServer(
    {
      key: readFileSync(`${directory}/key.pem`),
      cert: readFileSync(`${directory}/cert.pem`),
    },
    (incoming, outgoing) => {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: testBackendPort,
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
  server.listen(Number(new URL(testOrigin).port), '127.0.0.1');
} catch (error) {
  close();
  throw error;
}
