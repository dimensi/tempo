import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';

it('upgrades an existing foundation DB repeatedly without losing users or grants', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yazio-upgrade-'));
  const legacy = join(directory, 'legacy');
  mkdirSync(join(legacy, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(legacy, 'meta/_journal.json'), JSON.stringify(journal));
  cpSync(
    `drizzle/${journal.entries[0].tag}.sql`,
    join(legacy, `${journal.entries[0].tag}.sql`),
  );
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
    for (const table of [
      'measurements',
      'workout_plans',
      'workout_sessions',
      'comments',
      'trainer_invitations',
      'nutrition_days',
      'nutrition_photos',
      'nutrition_cache',
      'nutrition_sync_runs',
    ])
      expect(
        database.sqlite
          .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', table),
      ).toEqual({ name: table });
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe(
      'ok',
    );
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('adds required media status to persisted sync history once without changing food outcomes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yazio-media-upgrade-'));
  const previous = join(directory, 'previous');
  mkdirSync(join(previous, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 4);
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    cpSync(`drizzle/${entry.tag}.sql`, join(previous, `${entry.tag}.sql`));
  const database = openDatabase(`file:${join(directory, 'existing.sqlite')}`);
  try {
    migrate(database.db, { migrationsFolder: previous });
    database.db
      .insert(user)
      .values({
        id: 'owner',
        role: 'OWNER',
        name: 'owner',
        email: 'owner@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const status = {
      state: 'partial',
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:01:00.000Z',
      completedDates: ['2026-10-09'],
      failedDates: ['2026-10-10'],
    };
    database.sqlite
      .prepare('INSERT INTO nutrition_sync_runs(owner_id,status) VALUES (?,?)')
      .run('owner', JSON.stringify(status));
    migrate(database.db, { migrationsFolder: './drizzle' });
    migrate(database.db, { migrationsFolder: './drizzle' });
    const row = database.sqlite
      .prepare('SELECT status FROM nutrition_sync_runs WHERE owner_id=?')
      .get('owner') as { status: string };
    expect(JSON.parse(row.status)).toEqual({ ...status, photoFailedDates: [] });
    expect(database.db.select().from(user).all()).toHaveLength(1);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe(
      'ok',
    );
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
