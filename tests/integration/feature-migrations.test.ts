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
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { syncProgress } from '@/server/yazio/sync-progress';
import { nutritionRepository } from '@/server/nutrition/repository';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
vi.mock('server-only', () => ({}));

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
      'owner_settings',
      'measurements',
      'workout_plans',
      'workout_sessions',
      'comments',
      'trainer_invitations',
      'nutrition_days',
      'nutrition_photos',
      'nutrition_cache',
      'nutrition_sync_runs',
      'yazio_sync_progress',
    ])
      expect(
        database.sqlite
          .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', table),
      ).toEqual({ name: table });
    expect(
      database.sqlite.prepare('SELECT * FROM owner_settings').all(),
    ).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe(
      'ok',
    );
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('adopts saved history without upstream reads, retains known failures and schedules four hours ahead only once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yazio-progress-upgrade-'));
  const previous = join(directory, 'previous');
  mkdirSync(join(previous, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.filter(
    (entry: { tag: string }) => entry.tag !== '0016_pink_odin',
  );
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
    const insert = database.sqlite.prepare(
      'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES (?,?,?,?)',
    );
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03'])
      insert.run('owner', date, '{}', '2026-10-04T00:00:00Z');
    const status = {
      state: 'partial',
      startedAt: null,
      finishedAt: null,
      completedDates: ['2026-10-01', '2026-10-02'],
      failedDates: ['2026-10-03'],
      photoFailedDates: ['2026-10-02'],
    };
    database.sqlite
      .prepare('INSERT INTO nutrition_sync_runs(owner_id,status) VALUES (?,?)')
      .run('owner', JSON.stringify(status));
    database.db
      .insert(nutritionSchedule)
      .values({
        ownerId: 'owner',
        enabled: true,
        nextRunAt: 1,
        initialFrom: '2026-10-01',
      })
      .run();
    nutritionRepository(database).addPhoto({
      id: 'manual',
      ownerId: 'owner',
      date: '2026-09-30',
      daytime: 'lunch',
      source: 'manual',
      storageKey: 'a'.repeat(64),
      contentHash: 'a'.repeat(64),
      sourceUrl: null,
      observedAt: '2026-10-04T00:00:00Z',
      mime: 'image/jpeg',
    });
    migrate(database.db, { migrationsFolder: './drizzle' });
    const progress = syncProgress(database);
    expect(progress.get('owner', '2026-10-01')).toMatchObject({
      food: true,
      photos: true,
      steps: true,
      weight: true,
      body: true,
    });
    expect(progress.get('owner', '2026-10-02')).toMatchObject({
      food: true,
      photos: false,
    });
    expect(progress.get('owner', '2026-10-03')).toMatchObject({
      food: false,
      photos: false,
    });
    expect(progress.get('owner', '2026-09-30')).toBeUndefined();
    expect(nutritionRepository(database).status('owner')).toEqual({
      ...status,
      skippedDates: [],
    });
    const scheduled = database.db.select().from(nutritionSchedule).get()!;
    expect(Math.abs(scheduled.nextRunAt! - Date.now() - 14400000)).toBeLessThan(
      2000,
    );
    migrate(database.db, { migrationsFolder: './drizzle' });
    expect(database.db.select().from(nutritionSchedule).get()).toEqual(
      scheduled,
    );
    expect(
      database.sqlite.prepare('SELECT snapshot FROM nutrition_days').all(),
    ).toEqual([{ snapshot: '{}' }, { snapshot: '{}' }, { snapshot: '{}' }]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
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
      skippedDates: [],
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
    expect(JSON.parse(row.status)).toEqual({
      ...status,
      photoFailedDates: [],
      skippedDates: [],
    });
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
