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
