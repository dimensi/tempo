// Run after pnpm build: node tests/nutrition-scheduler/runtime-smoke.mjs
// Owns only temporary SQLite/files and the child servers it starts; no browser,
// production env inheritance, credentials, token contents or upstream connection.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const standalone = resolve('.next/standalone');
assert(
  existsSync(join(standalone, 'server.js')),
  'Build the standalone app first',
);
const directory = mkdtempSync(join(tmpdir(), 'nutrition-timer-smoke-'));
const databaseFile = join(directory, 'synthetic.sqlite');
const tokenFile = join(directory, 'absent-synthetic-token.json');
const sqlite = new Database(databaseFile, { timeout: 5000 });
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
migrate(drizzle(sqlite), { migrationsFolder: resolve('drizzle') });
sqlite
  .prepare(
    'INSERT INTO user (id,name,email,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
  )
  .run(
    'synthetic-owner',
    'Synthetic fixture',
    'synthetic@example.test',
    'OWNER',
    Date.now(),
    Date.now(),
  );

let child;
let childExit;
const schedule = () =>
  sqlite
    .prepare('SELECT * FROM nutrition_schedule WHERE owner_id = ?')
    .get('synthetic-owner');
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert(
      !child || child.exitCode === null,
      'Synthetic server exited unexpectedly',
    );
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(`Runtime smoke timeout: ${label}`);
}
async function freePort() {
  const socket = createServer();
  await new Promise((yes, no) => {
    socket.once('error', no);
    socket.listen(0, '127.0.0.1', yes);
  });
  const port = socket.address().port;
  await new Promise((yes) => socket.close(yes));
  return port;
}
async function start() {
  const port = await freePort();
  child = spawn(process.execPath, [join(standalone, 'server.js')], {
    cwd: standalone,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL: `file:${databaseFile}`,
      BETTER_AUTH_URL: 'https://synthetic.example.test',
      BETTER_AUTH_SECRET: 'runtime-smoke-only-synthetic-auth-secret-12345',
      UPLOADS_DIR: join(directory, 'uploads'),
      DEMO_MODE: 'false',
      YAZIO_TOKEN_FILE: tokenFile,
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  childExit = new Promise((yes) => child.once('exit', yes));
  await waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      } catch {
        return false;
      }
    },
    15000,
    'server health',
  );
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  current.kill('SIGTERM');
  const exited = await Promise.race([
    childExit.then(() => true),
    delay(5000).then(() => false),
  ]);
  if (!exited) {
    current.kill('SIGKILL');
    await childExit;
  }
  child = undefined;
}
try {
  await start();
  assert.equal(
    schedule(),
    undefined,
    'Instrumentation must not eagerly read/adopt on registration',
  );
  // No browser is started or kept open. An independent production timer creates
  // the legacy-owner schedule only after its first delayed tick.
  await waitFor(
    () => schedule()?.last_error === 'NOT_CONFIGURED',
    45000,
    'delayed legacy adoption',
  );
  assert.equal(schedule().enabled, 0);
  assert.equal(schedule().timezone, 'UTC');
  assert.equal(schedule().lease_id, null);
  assert.equal(existsSync(tokenFile), false, 'No token or credentials created');
  await stop();

  const previousLease = 'synthetic-prior-process-lease';
  sqlite
    .prepare(
      'UPDATE nutrition_schedule SET enabled=1,epoch=epoch+1,next_run_at=?,attempt=0,lease_id=?,lease_expires_at=?,lease_started_at=?,last_error=NULL WHERE owner_id=?',
    )
    .run(
      Date.now() - 3600000,
      previousLease,
      Date.now() - 1,
      Date.now() - 130000,
      'synthetic-owner',
    );
  sqlite
    .prepare(
      'INSERT INTO nutrition_sync_runs(owner_id,status) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET status=excluded.status',
    )
    .run(
      'synthetic-owner',
      JSON.stringify({
        state: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        completedDates: [],
        failedDates: [],
        photoFailedDates: [],
      }),
    );
  const restartedAt = Date.now();
  await start();
  assert.equal(
    schedule().lease_id,
    previousLease,
    'Restart must not eagerly run on registration',
  );
  await waitFor(
    () =>
      schedule()?.last_error === 'NOT_CONFIGURED' &&
      schedule()?.lease_id === null,
    45000,
    'persistent expired lease recovery',
  );
  assert.equal(schedule().attempt, 1);
  assert.equal(
    JSON.parse(
      sqlite
        .prepare('SELECT status FROM nutrition_sync_runs WHERE owner_id=?')
        .get('synthetic-owner').status,
    ).state,
    'failed',
    'A disconnected restart must reconcile stale running status',
  );
  assert(schedule().next_run_at > restartedAt);
  assert.equal(existsSync(tokenFile), false);
  console.log(
    JSON.stringify({
      timer: 'production-delayed',
      browserRequired: false,
      restart: 'expired-lease-reclaimed',
      upstream: 'blocked-without-token',
      credentialFilesCreated: false,
    }),
  );
} finally {
  await stop();
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
}
