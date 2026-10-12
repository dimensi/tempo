import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { startUpstream } from './upstream';

for (const file of [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
])
  if (existsSync(file))
    throw new Error(
      'Remove local environment files before synthetic runtime testing',
    );

// Explicit environment prevents inherited root credentials, NODE_OPTIONS and .env values.
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: 'development',
  DATABASE_URL: 'file:./.data/e2e.sqlite',
  BETTER_AUTH_URL: 'http://localhost:3157',
  BETTER_AUTH_SECRET: 'transformmate-e2e-only-secret-123456789012345',
  DEMO_MODE: 'false',
  YAZIO_TOKEN_FILE: '',
  ENABLE_NUTRITION_SCHEDULER: 'false',
  TRANSFORMMATE_FIREBASE_API_KEY: 'synthetic-api-key',
  TRANSFORMMATE_FIREBASE_REFRESH_TOKEN: 'synthetic-refresh-token',
  NEXT_TELEMETRY_DISABLED: '1',
};
const server = await startUpstream();
execFileSync('pnpm', ['exec', 'tsx', 'scripts/prepare-e2e.ts'], {
  env,
  stdio: 'inherit',
});
const child = spawn('pnpm', ['dev', '--port', '3157'], {
  env: {
    ...env,
    NODE_OPTIONS: `--require=${resolve('tests/transformmate-sync/fetch-preload.cjs')}`,
  },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    child.kill(signal);
    server.close();
  });
child.on('exit', (code) => {
  server.close();
  process.exit(code ?? 1);
});
