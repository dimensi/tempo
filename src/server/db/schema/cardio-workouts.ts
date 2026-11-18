import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
import type {
  CardioInput,
  CardioOverrides,
  ImportedExercise,
} from '@/contracts/cardio-workouts';

export const cardioWorkouts = sqliteTable(
  'cardio_workouts',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    date: text('date').notNull(),
    revision: integer('revision').notNull().default(1),
    manual: text('manual', { mode: 'json' }).$type<CardioInput>(),
    imported: text('imported', { mode: 'json' }).$type<ImportedExercise>(),
    overrides: text('overrides', { mode: 'json' }).$type<CardioOverrides>(),
    linkKind: text('link_kind', { enum: ['cardio', 'strength'] }),
    linkId: text('link_id'),
    automaticLink: integer('automatic_link', { mode: 'boolean' })
      .notNull()
      .default(false),
    suppressMatch: integer('suppress_match', { mode: 'boolean' })
      .notNull()
      .default(false),
    present: integer('present', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    index('cardio_workouts_owner_date_idx').on(t.ownerId, t.date),
    uniqueIndex('cardio_workouts_target_unique')
      .on(t.ownerId, t.linkKind, t.linkId)
      .where(sql`present = 1`),
  ],
);

export const yazioExerciseCoverage = sqliteTable(
  'yazio_exercise_coverage',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    fetchedAt: text('fetched_at'),
    failedAt: text('failed_at'),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.date] })],
);
