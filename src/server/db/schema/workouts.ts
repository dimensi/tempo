import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
import type { WorkoutPlanInput, WorkoutSession } from '@/contracts/workouts';

export const workoutPlans = sqliteTable(
  'workout_plans',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    data: text('data', { mode: 'json' }).$type<WorkoutPlanInput>().notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('workout_plans_owner_idx').on(table.ownerId)],
);

export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // References and snapshot remain after a plan is deleted; actual data is independent.
    data: text('data', { mode: 'json' })
      .$type<
        Omit<
          WorkoutSession,
          'id' | 'ownerId' | 'revision' | 'createdAt' | 'updatedAt'
        >
      >()
      .notNull(),
    date: text('date').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('workout_sessions_owner_date_idx').on(table.ownerId, table.date),
  ],
);
