import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function verifyFixtureSnapshot(
  family: string,
  hash: string,
  directory = process.cwd(),
) {
  if (
    ![
      'general',
      'smoke',
      'isolation',
      'offline',
      'transformmate',
      'nutrition',
    ].includes(family) ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw new Error(
      'Prepared synthetic fixture is only supported by isolated browser families',
    );
  const path = resolve(directory, '.data/e2e.sqlite');
  if (
    ['-wal', '-shm'].some((suffix) => existsSync(path + suffix)) ||
    createHash('sha256').update(readFileSync(path)).digest('hex') !== hash
  )
    throw new Error('Prepared synthetic fixture is not a fresh exact copy');
}
