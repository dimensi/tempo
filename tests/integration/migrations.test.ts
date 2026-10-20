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
import { expect, it, vi } from 'vitest';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
import { projectDetail } from '@/server/transformmate/catalog-projection';
vi.mock('server-only', () => ({}));
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
  const replicaStart = journal.entries.findIndex(
    (e) => e.tag === '0017_clean_changeling',
  );
  const entries = journal.entries.slice(0, replicaStart);
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

    const oldDetail = {
      ...projectDetail(exerciseDetailFixture()),
      kinescope_data: [
        {
          url: 'https://kinescopecdn.net/demo.mp4?sign=synthetic',
          filetype: 'mp4',
        },
      ],
    };
    const insert = database.sqlite.prepare(
      'INSERT INTO transformmate_catalog_exercise(owner_id,account_scope,generation,locale,exercise_id,summary,summary_fetched_at,detail,detail_fetched_at,in_full_catalog) VALUES(?,?,?,?,?,?,?,?,?,?)',
    );
    insert.run(
      'owner',
      'account',
      'old',
      'ru',
      501,
      JSON.stringify({ id: 501, name: 'Older name', metrics: [] }),
      '2026-01-01T00:00:00Z',
      JSON.stringify(oldDetail),
      '2026-01-01T00:00:00Z',
      1,
    );
    insert.run(
      'owner',
      'account',
      'new',
      'ru',
      501,
      JSON.stringify({ id: 501, name: 'Latest name', metrics: [] }),
      '2026-02-01T00:00:00Z',
      null,
      null,
      1,
    );
    const state = database.sqlite.prepare(
      'INSERT INTO transformmate_catalog_state(owner_id,account_scope,generation,locale,full_catalog_fetched_at,full_catalog_count) VALUES(?,?,?,?,?,?)',
    );
    state.run('owner', 'account', 'old', 'ru', '2026-01-01T00:00:00Z', 1);
    state.run('owner', 'account', 'new', 'ru', '2026-02-01T00:00:00Z', 1);
    // Upgrade the original catalog first, then preserve a deployed replica job through stage-error migration.
    const replicaEntries = journal.entries.slice(0, replicaStart + 1);
    writeFileSync(
      join(legacy, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: replicaEntries }),
    );
    for (const { tag } of replicaEntries)
      cpSync(`drizzle/${tag}.sql`, join(legacy, `${tag}.sql`));
    migrate(database.db, { migrationsFolder: legacy });
    const replicaData = {
      detailAt: 0,
      imageAt: 0,
      videoAt: 1000,
      posterAt: 1000,
      video: {
        key: 'synthetic/video.mp4',
        size: 12,
        type: 'video/mp4',
        fingerprint: 'synthetic',
        etag: null,
        modified: null,
      },
      poster: {
        key: 'synthetic/poster.jpg',
        size: 5,
        type: 'image/jpeg',
        fingerprint: 'synthetic/video.mp4',
        etag: null,
        modified: null,
      },
    };
    database.sqlite
      .prepare(
        'INSERT INTO transformmate_replica_jobs(owner_id,account_scope,locale,key,next_at,attempts,error,data) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        'owner',
        'account',
        'ru',
        'exercise:501',
        123456,
        2,
        'invalid_media',
        JSON.stringify(replicaData),
      );
    migrate(database.db, { migrationsFolder: './drizzle' });
    migrate(database.db, { migrationsFolder: './drizzle' });
    const copied = database.sqlite
      .prepare(
        'SELECT summary,detail FROM transformmate_catalog_exercise WHERE owner_id=? AND account_scope=?',
      )
      .all('owner', 'account') as { summary: string; detail: string }[];
    expect(copied).toHaveLength(1);
    expect(JSON.parse(copied[0]!.summary).name).toBe('Latest name');
    expect(JSON.parse(copied[0]!.detail)).toMatchObject({
      description: oldDetail.description,
      kinescope_data: [{ id: null, resolution: null }],
    });
    const replicaJob = database.sqlite
      .prepare(
        "SELECT data,next_at,attempts FROM transformmate_replica_jobs WHERE key='exercise:501'",
      )
      .get() as { data: string; next_at: number; attempts: number };
    expect(JSON.parse(replicaJob.data)).toMatchObject({
      failures: { image: { reason: 'invalid_media', httpStatus: null } },
      video: replicaData.video,
      poster: replicaData.poster,
    });
    expect(replicaJob).toMatchObject({ next_at: 123456, attempts: 2 });
    expect(
      database.sqlite.pragma('table_info(transformmate_replica_jobs)'),
    ).not.toContainEqual(expect.objectContaining({ name: 'error' }));
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
