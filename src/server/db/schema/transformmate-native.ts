import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

/** Read-only provider history, separate from local plans and publication intents. */
export const workoutTransformMateNative = sqliteTable(
  'workout_transformmate_native',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountScope: text('account_scope').notNull(),
    remoteTrainingId: integer('remote_training_id').notNull(),
    date: text('date').notNull(),
    revision: integer('revision').notNull().default(1),
    snapshot: text('snapshot').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('workout_tm_native_remote_unique').on(
      table.ownerId,
      table.accountScope,
      table.remoteTrainingId,
    ),
    index('workout_tm_native_date_idx').on(
      table.ownerId,
      table.accountScope,
      table.date,
    ),
    check('workout_tm_native_revision_positive', sql`${table.revision} >= 1`),
    check(
      'workout_tm_native_remote_positive',
      sql`${table.remoteTrainingId} > 0`,
    ),
  ],
);
