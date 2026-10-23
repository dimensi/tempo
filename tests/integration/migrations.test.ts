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
import { workoutRepository } from '@/server/workouts/repository';

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
    database.sqlite
      .prepare(
        'INSERT INTO owner_settings(owner_id,daily_steps_goal) VALUES (?,?)',
      )
      .run('owner', 12345);
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
    database.sqlite
      .prepare(
        "INSERT INTO medical_documents(id,owner_id,filename,storage_key,sha256,mime_type,size_bytes,page_count,created_at,updated_at) VALUES('existing-medical-document','owner','synthetic.pdf','synthetic-medical','synthetic-sha','application/pdf',100,2,1,1)",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO medical_import_jobs(id,owner_id,document_id,status,stage,attempts,created_at,updated_at) VALUES('existing-medical-job','owner','existing-medical-document','queued','upload_validation',0,1,1)",
      )
      .run();
    const occurrence = {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Squat',
      sets: [{ reps: 8, weightKg: 55 }],
    };
    const planned = (id: string, title: string) => ({
      title,
      description: 'Keep description',
      startsOn: '2026-10-01',
      endsOn: '2026-10-01',
      workouts: [
        { id, date: '2026-10-01', title: 'Day title', exercises: [occurrence] },
      ],
    });
    const insertPlan = database.sqlite.prepare(
      'INSERT INTO workout_plans(id,owner_id,data,revision,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    );
    for (const [id, nested] of [
      ['plan-a', 'duplicate'],
      ['plan-b', 'duplicate'],
      ['linked-plan', 'linked-day'],
    ]) {
      const legacyPlan = planned(nested!, id!);
      if (id === 'plan-a')
        legacyPlan.workouts[0]!.exercises.push({
          ...occurrence,
          name: 'Duplicate identity',
        });
      insertPlan.run(
        id,
        'owner',
        JSON.stringify(legacyPlan),
        1,
        '2026-10-01T00:00:00Z',
        '2026-10-01T00:00:00Z',
      );
    }
    const actual = {
      date: '2026-10-01',
      title: 'Actual',
      note: 'Keep result note',
      exercises: [occurrence],
      status: 'completed',
      planId: 'linked-plan',
      plannedWorkoutId: 'linked-day',
      planSnapshot: {
        planTitle: 'Original parent',
        workout: planned('linked-day', 'Original parent').workouts[0],
      },
    };
    const insertSession = database.sqlite.prepare(
      'INSERT INTO workout_sessions(id,owner_id,data,date,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    );
    insertSession.run(
      'legacy-fact',
      'owner',
      JSON.stringify(actual),
      actual.date,
      3,
      '2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    );
    insertSession.run(
      'legacy-repeat',
      'owner',
      JSON.stringify({
        ...actual,
        exercises: [
          {
            ...occurrence,
            sets: [],
            transformMate: { exerciseId: 501, occurrenceKey: occurrence.id },
          },
          {
            ...occurrence,
            id: '10000000-0000-4000-8000-000000000002',
            sets: [],
            transformMate: { exerciseId: 501, occurrenceKey: occurrence.id },
          },
        ],
        status: 'in_progress',
      }),
      actual.date,
      4,
      '2026-10-02T00:00:00Z',
      '2026-10-02T00:00:00Z',
    );
    insertSession.run(
      'legacy-orphan',
      'owner',
      JSON.stringify({
        ...actual,
        planId: 'deleted-plan',
        planSnapshot: { ...actual.planSnapshot, planTitle: 'Deleted parent' },
      }),
      actual.date,
      2,
      '2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    );
    insertSession.run(
      'legacy-skipped',
      'owner',
      JSON.stringify({
        ...actual,
        planId: null,
        plannedWorkoutId: null,
        planSnapshot: null,
        status: 'skipped',
      }),
      actual.date,
      1,
      '2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    );
    database.sqlite
      .prepare(
        'INSERT INTO workout_videos(id,owner_id,session_id,exercise_id,size,duration,state,parts,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'legacy-video',
        'owner',
        'legacy-fact',
        occurrence.id,
        12,
        1,
        'ready',
        '{}',
        1,
      );
    database.sqlite
      .prepare(
        'INSERT INTO comments(id,owner_id,author_id,target_type,target_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        'legacy-comment',
        'owner',
        'owner',
        'workout',
        'legacy-fact',
        'Keep comment',
        1,
        1,
      );
    const providerSnapshot = actual.planSnapshot;
    const providerState = {
      workout: providerSnapshot.workout,
      published: providerSnapshot,
      updateAttempt: { previous: providerSnapshot, desired: providerSnapshot },
      marker: 'keep-marker',
      baseline: 'keep-fingerprint',
    };
    database.sqlite
      .prepare(
        'INSERT INTO workout_transformmate_links(id,owner_id,plan_id,workout_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        'legacy-link',
        'owner',
        'linked-plan',
        'linked-day',
        JSON.stringify(providerState),
        '2026-10-01T00:00:00Z',
        '2026-10-01T00:00:00Z',
      );
    // Rehearse an installation that has already applied the unified-workout migration.
    const unified = join(directory, 'unified');
    const unifiedEntries = journal.entries.slice(
      0,
      journal.entries.findIndex(
        (e) => e.tag === '0021_rapid_carmella_unuscione',
      ) + 1,
    );
    mkdirSync(join(unified, 'meta'), { recursive: true });
    writeFileSync(
      join(unified, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: unifiedEntries }),
    );
    for (const { tag } of unifiedEntries)
      cpSync(`drizzle/${tag}.sql`, join(unified, `${tag}.sql`));
    migrate(database.db, { migrationsFolder: unified });
    expect(() => workoutRepository(database.db).list('owner')).toThrow();
    const beforeTarget = join(directory, 'before-target');
    mkdirSync(join(beforeTarget, 'meta'), { recursive: true });
    const beforeTargetEntries = journal.entries.slice(0, -1);
    writeFileSync(
      join(beforeTarget, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: beforeTargetEntries }),
    );
    for (const { tag } of beforeTargetEntries)
      cpSync(`drizzle/${tag}.sql`, join(beforeTarget, `${tag}.sql`));
    migrate(database.db, { migrationsFolder: beforeTarget });
    database.sqlite
      .prepare(
        'INSERT INTO yazio_daily_goals (owner_id,date,calories,steps,fetched_at) VALUES (?,?,?,?,?)',
      )
      .run('owner', '2026-10-01', '2100', 9000, '2026-10-01T00:00:00Z');
    migrate(database.db, { migrationsFolder: './drizzle' });
    expect(
      database.sqlite
        .prepare('SELECT calories,steps,weight FROM yazio_daily_goals')
        .get(),
    ).toEqual({ calories: '2100', steps: 9000, weight: null });
    expect(
      database.sqlite
        .prepare(
          'SELECT daily_steps_goal FROM owner_settings WHERE owner_id = ?',
        )
        .get('owner'),
    ).toEqual({ daily_steps_goal: 12345 });
    expect(
      database.sqlite
        .prepare('SELECT count(*) AS count FROM yazio_daily_goals')
        .get(),
    ).toEqual({ count: 1 });

    migrate(database.db, { migrationsFolder: './drizzle' });
    const workoutRows = database.sqlite
      .prepare('SELECT id,data FROM workouts')
      .all() as { id: string; data: string }[];
    expect(workoutRows).toHaveLength(6);
    const migrated = (id: string) =>
      JSON.parse(workoutRows.find((r) => r.id === id)!.data);
    expect(migrated('legacy-fact').exercises).toEqual(actual.exercises);
    expect(migrated('legacy-fact').note).toContain(actual.note);
    expect(migrated('legacy-fact')).not.toHaveProperty('planSnapshot');
    expect(migrated('legacy-repeat').exercises[0].sets).toEqual([]);
    expect(migrated('legacy-orphan').note).toContain('Deleted parent');
    expect(migrated('legacy-skipped')).toMatchObject({
      status: 'planned',
      note: expect.stringContaining('Была пропущена'),
    });
    const duplicates = workoutRows.filter(
      (r) => JSON.parse(r.data).legacySource?.workoutId === 'duplicate',
    );
    expect(new Set(duplicates.map((r) => r.id)).size).toBe(2);
    const canonical = workoutRepository(database.db).list('owner').workouts;
    expect(canonical).toHaveLength(6);
    const normalizedPlan = canonical.find(
      (workout) => workout.legacySource?.planId === 'plan-a',
    )!;
    expect(normalizedPlan.exercises.map((exercise) => exercise.name)).toEqual([
      'Squat',
      'Duplicate identity',
    ]);
    expect(normalizedPlan.exercises[0]?.id).toBe(occurrence.id);
    expect(
      new Set(normalizedPlan.exercises.map((exercise) => exercise.id)).size,
    ).toBe(2);
    const normalizedSession = canonical.find(
      (workout) => workout.id === 'legacy-repeat',
    )!;
    expect(normalizedSession.exercises.map((exercise) => exercise.id)).toEqual([
      occurrence.id,
      '10000000-0000-4000-8000-000000000002',
    ]);
    expect(
      new Set(
        normalizedSession.exercises.map(
          (exercise) => exercise.transformMate?.occurrenceKey,
        ),
      ).size,
    ).toBe(2);
    expect(normalizedSession.revision).toBe(5);
    expect(
      duplicates.every((r) =>
        JSON.parse(r.data).note.includes(
          JSON.parse(r.data).legacySource.planId,
        ),
      ),
    ).toBe(true);
    expect(
      database.sqlite
        .prepare('SELECT workout_id,exercise_id FROM workout_videos WHERE id=?')
        .get('legacy-video'),
    ).toEqual({ workout_id: 'legacy-fact', exercise_id: occurrence.id });
    expect(
      database.sqlite
        .prepare('SELECT target_id FROM comments WHERE id=?')
        .get('legacy-comment'),
    ).toEqual({ target_id: 'legacy-fact' });
    const link = database.sqlite
      .prepare(
        'SELECT workout_id,state FROM workout_transformmate_links WHERE id=?',
      )
      .get('legacy-link') as { workout_id: string; state: string };
    const migratedState = JSON.parse(link.state);
    expect(link.workout_id).toBe('legacy-repeat');
    for (const snapshot of [
      migratedState,
      migratedState.published,
      migratedState.updateAttempt.previous,
      migratedState.updateAttempt.desired,
    ])
      expect(snapshot.workout.id).toBe('legacy-repeat');
    expect(migratedState).toMatchObject({
      marker: 'keep-marker',
      baseline: 'keep-fingerprint',
    });
    expect(
      database.sqlite
        .prepare(
          "SELECT status, failed_pages_json FROM medical_import_jobs WHERE id='existing-medical-job'",
        )
        .get(),
    ).toEqual({ status: 'queued', failed_pages_json: '[]' });
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
