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
      expect(sql.prepare('SELECT data FROM workout_sessions').get()).toEqual({
        data: session,
      });
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
      sql.prepare('DELETE FROM workout_plans WHERE id=?').run('plan');
      expect(
        sql
          .prepare('SELECT count(*) AS count FROM workout_transformmate_links')
          .get(),
      ).toEqual({ count: 3 });
      expect(sql.prepare('SELECT data FROM workout_sessions').get()).toEqual({
        data: session,
      });
      expect(sql.pragma('foreign_key_check')).toEqual([]);
      expect(sql.pragma('integrity_check', { simple: true })).toBe('ok');
      sql.prepare('DELETE FROM user WHERE id=?').run('owner');
      expect(
        sql
          .prepare('SELECT count(*) AS count FROM workout_transformmate_links')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
