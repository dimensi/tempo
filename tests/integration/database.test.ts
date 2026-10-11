import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
it('migrations are repeatable, WAL persists users after reopen and only one owner is allowed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nutrition-db-'));
  const url = `file:${directory}/test.sqlite`;
  let connection = openDatabase(url);
  try {
    migrate(connection.db, { migrationsFolder: './drizzle' });
    migrate(connection.db, { migrationsFolder: './drizzle' });
    expect(connection.sqlite.pragma('journal_mode', { simple: true })).toBe(
      'wal',
    );
    connection.db
      .insert(user)
      .values({
        id: 'owner',
        name: 'Owner',
        email: 'owner@example.test',
        role: 'OWNER',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    expect(() =>
      connection.db
        .insert(user)
        .values({
          id: 'other',
          name: 'Other',
          email: 'other@example.test',
          role: 'OWNER',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow();
    connection.sqlite.close();
    connection = openDatabase(url);
    expect(connection.db.select().from(user).all()).toHaveLength(1);
    expect(connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  } finally {
    connection.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
