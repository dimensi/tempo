import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';

it.each(['fresh', 'existing'] as const)(
  'migrates %s DB with scoped unique links and preserves manual workout history',
  (kind) => {
    const directory = mkdtempSync(join(tmpdir(), 'transformmate-migration-'));
    const database = openDatabase(
      `file:${join(directory, 'synthetic.sqlite')}`,
    );
    try {
      const previous = join(directory, 'previous');
      mkdirSync(join(previous, 'meta'), { recursive: true });
      const journal = JSON.parse(
        readFileSync('drizzle/meta/_journal.json', 'utf8'),
      );
      journal.entries = journal.entries.slice(0, 5);
      writeFileSync(
        join(previous, 'meta/_journal.json'),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        cpSync(`drizzle/${entry.tag}.sql`, join(previous, `${entry.tag}.sql`));
      migrate(database.db, {
        migrationsFolder: kind === 'existing' ? previous : './drizzle',
      });
      const sql = database.sqlite;
      sql
        .prepare(
          'INSERT INTO user(id,name,email,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        )
        .run('owner', 'Synthetic owner', 'owner@example.test', 'OWNER', 0, 0);
      const plan = JSON.stringify({
        title: 'Manual plan',
        description: 'Preserve me',
        startsOn: '2026-10-12',
        endsOn: '2026-10-12',
        workouts: [
          {
            id: 'workout',
            date: '2026-10-12',
            title: 'Manual',
            exercises: [
              { name: 'Manual', sets: [{ reps: 10, weightKg: null }] },
            ],
          },
        ],
      });
      const session = JSON.stringify({
        date: '2026-10-12',
        title: 'Completed',
        status: 'completed',
        note: 'Actual',
        planId: 'plan',
        plannedWorkoutId: 'workout',
        planSnapshot: {
          planTitle: 'Manual plan',
          workout: JSON.parse(plan).workouts[0],
        },
        exercises: [{ name: 'Manual', sets: [{ reps: 8, weightKg: 20 }] }],
      });
      sql
        .prepare(
          'INSERT INTO workout_plans(id,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?)',
        )
        .run(
          'plan',
          'owner',
          plan,
          '2026-10-12T00:00:00.000Z',
          '2026-10-12T00:00:00.000Z',
        );
      sql
        .prepare(
          'INSERT INTO workout_sessions(id,owner_id,date,data,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        )
        .run(
          'actual',
          'owner',
          '2026-10-12',
          session,
          '2026-10-12T00:00:00.000Z',
          '2026-10-12T00:00:00.000Z',
        );
      migrate(database.db, { migrationsFolder: './drizzle' });
      migrate(database.db, { migrationsFolder: './drizzle' });
      expect(sql.prepare('SELECT data FROM workout_plans').get()).toEqual({
        data: plan,
      });
      const storedSession = JSON.parse(
        (
          sql.prepare('SELECT data FROM workout_sessions').get() as {
            data: string;
          }
        ).data,
      );
      if (kind === 'existing') {
        expect(storedSession.exercises[0].id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const occurrenceId = storedSession.exercises[0].id;
        migrate(database.db, { migrationsFolder: './drizzle' });
        expect(
          JSON.parse(
            (
              sql.prepare('SELECT data FROM workout_sessions').get() as {
                data: string;
              }
            ).data,
          ).exercises[0].id,
        ).toBe(occurrenceId);
        delete storedSession.exercises[0].id;
      }
      expect(storedSession).toEqual(JSON.parse(session));
      const insert = sql.prepare(
        'INSERT INTO workout_transformmate_links(id,owner_id,plan_id,workout_id,remote_training_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      );
      const link = (
        id: string,
        workoutId: string,
        remoteId: number | null,
        owner = 'owner',
      ) =>
        insert.run(
          id,
          owner,
          'plan',
          workoutId,
          remoteId,
          '{}',
          '2026-10-12T00:00:00.000Z',
          '2026-10-12T00:00:00.000Z',
        );
      link('link1', 'workout', 123);
      expect(() => link('duplicate-local', 'workout', 124)).toThrow();
      expect(() => link('duplicate-remote', 'other-workout', 123)).toThrow();
      link('pending1', 'pending1', null);
      link('pending2', 'pending2', null);
      expect(() => link('foreign-owner', 'foreign', null, 'missing')).toThrow();
      const native = sql.prepare(
        'INSERT INTO workout_transformmate_native(id,owner_id,account_scope,remote_training_id,date,revision,snapshot,fetched_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      );
      const nativeRow = (
        id: string,
        scope: string,
        remoteId: number,
        revision = 1,
      ) =>
        native.run(
          id,
          'owner',
          scope,
          remoteId,
          '2026-10-12',
          revision,
          '{}',
          '2026-10-12T00:00:00.000Z',
          '2026-10-12T00:00:00.000Z',
          '2026-10-12T00:00:00.000Z',
        );
      nativeRow('native1', 'a'.repeat(64), 777);
      expect(() =>
        nativeRow('duplicate-native', 'a'.repeat(64), 777),
      ).toThrow();
      nativeRow('other-account', 'b'.repeat(64), 777);
      expect(() => nativeRow('invalid-remote', 'a'.repeat(64), 0)).toThrow();
      expect(() =>
        nativeRow('invalid-revision', 'a'.repeat(64), 778, 0),
      ).toThrow();
      sql.prepare('DELETE FROM workout_plans WHERE id=?').run('plan');
      expect(
        sql
          .prepare('SELECT count(*) AS count FROM workout_transformmate_links')
          .get(),
      ).toEqual({ count: 3 });
      const stored = JSON.parse(
        (
          sql.prepare('SELECT data FROM workout_sessions').get() as {
            data: string;
          }
        ).data,
      );
      if (kind === 'existing') {
        expect(stored.exercises[0].id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const occurrenceId = stored.exercises[0].id;
        migrate(database.db, { migrationsFolder: './drizzle' });
        expect(
          JSON.parse(
            (
              sql.prepare('SELECT data FROM workout_sessions').get() as {
                data: string;
              }
            ).data,
          ).exercises[0].id,
        ).toBe(occurrenceId);
        delete stored.exercises[0].id;
      }
      expect(stored).toEqual(JSON.parse(session));
      expect(
        sql
          .prepare('SELECT count(*) AS count FROM workout_transformmate_native')
          .get(),
      ).toEqual({ count: 2 });
      expect(sql.pragma('foreign_key_check')).toEqual([]);
      expect(sql.pragma('integrity_check', { simple: true })).toBe('ok');
      sql.prepare('DELETE FROM user WHERE id=?').run('owner');
      expect(
        sql
          .prepare('SELECT count(*) AS count FROM workout_transformmate_links')
          .get(),
      ).toEqual({ count: 0 });
      expect(
        sql
          .prepare('SELECT count(*) AS count FROM workout_transformmate_native')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
