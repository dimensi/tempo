import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl =
  process.env.DATABASE_URL ?? 'file:./.data/development.sqlite';
const env = {
  ...process.env,
  DATABASE_URL:
    databaseUrl.startsWith('file:') && databaseUrl !== 'file::memory:'
      ? `file:${resolve(databaseUrl.slice(5))}`
      : databaseUrl,
  UPLOADS_DIR: resolve(process.env.UPLOADS_DIR ?? './.data/uploads'),
  ...(process.env.YAZIO_TOKEN_FILE
    ? { YAZIO_TOKEN_FILE: resolve(process.env.YAZIO_TOKEN_FILE) }
    : {}),
};
// The generated server changes cwd; preserve operator paths from this worktree.
const child = spawn(process.execPath, ['.next/standalone/server.js'], {
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
