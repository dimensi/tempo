import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

/** Durable attempts/results survive local plan deletion. Validated JSON lives in sync-state.ts. */
export const workoutTransformMateLinks = sqliteTable(
  'workout_transformmate_links',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    planId: text('plan_id').notNull(),
    workoutId: text('workout_id').notNull(),
    remoteTrainingId: integer('remote_training_id'),
    revision: integer('revision').notNull().default(1),
    state: text('state').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('workout_tm_local_unique').on(
      table.ownerId,
      table.planId,
      table.workoutId,
    ),
    uniqueIndex('workout_tm_remote_unique').on(
      table.ownerId,
      table.remoteTrainingId,
    ),
  ],
);
