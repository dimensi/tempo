import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { trainerAccess, user } from '@/server/db/schema';

it('applies fresh and upgrade migrations without losing durable access data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yazio-migration-'));
  const freshUrl = `file:${join(directory, 'fresh.sqlite')}`;
  const fresh = openDatabase(freshUrl);
  try {
    migrate(fresh.db, { migrationsFolder: './drizzle' });
    migrate(fresh.db, { migrationsFolder: './drizzle' });
    expect(fresh.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    fresh.db
      .insert(user)
      .values({
        id: 'fresh-owner',
        name: 'Fresh owner',
        email: 'fresh-owner@example.test',
        role: 'OWNER',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  } finally {
    fresh.sqlite.close();
  }
  const reopened = openDatabase(freshUrl);
  try {
    expect(reopened.db.select().from(user).all()).toHaveLength(1);
    expect(reopened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  } finally {
    reopened.sqlite.close();
  }

  const legacy = join(directory, 'legacy');
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  ) as {
    entries: { tag: string }[];
  };
  const entries = journal.entries.slice(0, -1);
  if (!entries.length) throw new Error('Expected a prior migration');
  mkdirSync(join(legacy, 'meta'), { recursive: true });
  writeFileSync(
    join(legacy, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries }),
  );
  for (const { tag } of entries)
    cpSync(`drizzle/${tag}.sql`, join(legacy, `${tag}.sql`));

  const database = openDatabase(`file:${join(directory, 'existing.sqlite')}`);
  try {
    migrate(database.db, { migrationsFolder: legacy });
    for (const [id, role] of [
      ['owner', 'OWNER'],
      ['trainer', 'TRAINER'],
    ] as const)
      database.db
        .insert(user)
        .values({
          id,
          role,
          name: id,
          email: `${id}@example.test`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
    database.db
      .insert(trainerAccess)
      .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
      .run();

    migrate(database.db, { migrationsFolder: './drizzle' });
    migrate(database.db, { migrationsFolder: './drizzle' });
    expect(database.db.select().from(user).all()).toHaveLength(2);
    expect(database.db.select().from(trainerAccess).get()?.ownerId).toBe(
      'owner',
    );
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe(
      'ok',
    );
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
