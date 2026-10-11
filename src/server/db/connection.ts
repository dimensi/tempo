import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
export function openDatabase(url: string) {
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL must use file:');
  const path = url.slice(5);
  if (path !== ':memory:')
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const sqlite = new Database(path, { timeout: 5000 });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
