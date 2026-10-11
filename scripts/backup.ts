import 'dotenv/config';
import { resolve } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from '../src/server/db/connection';
const destination = process.argv[2];
if (!destination)
  throw new Error('Usage: pnpm db:backup /secure/path/backup.sqlite');
const { sqlite } = openDatabase(
  process.env.DATABASE_URL ?? 'file:./.data/development.sqlite',
);
try {
  mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
  await sqlite.backup(resolve(destination));
  chmodSync(resolve(destination), 0o600);
  console.log('SQLite online backup completed');
} finally {
  sqlite.close();
}
