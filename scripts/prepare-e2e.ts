import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
if (process.env.DATABASE_URL !== 'file:./.data/e2e.sqlite')
  throw new Error('Only the disposable E2E database may be reset');
for (const suffix of ['', '-wal', '-shm'])
  rmSync(`.data/e2e.sqlite${suffix}`, { force: true });
execFileSync('pnpm', ['db:migrate'], { stdio: 'inherit' });
for (const role of ['OWNER', 'TRAINER'])
  execFileSync('pnpm', ['auth:create-user'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CREATE_USER_ROLE: role,
      CREATE_USER_NAME: role,
      CREATE_USER_EMAIL: `${role.toLowerCase()}@example.test`,
      CREATE_USER_PASSWORD: 'Test-only-password-12345',
    },
  });
