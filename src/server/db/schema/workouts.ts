import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
import type { WorkoutInput } from '@/contracts/workouts';
export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    data: text('data', { mode: 'json' }).$type<WorkoutInput>().notNull(),
    date: text('date').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('workouts_owner_date_idx').on(t.ownerId, t.date)],
);
