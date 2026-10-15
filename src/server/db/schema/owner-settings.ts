import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

export const ownerSettings = sqliteTable(
  'owner_settings',
  {
    ownerId: text('owner_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    dailyStepsGoal: integer('daily_steps_goal'),
  },
  (t) => [
    check(
      'owner_settings_steps_goal_check',
      sql`${t.dailyStepsGoal} is null or (typeof(${t.dailyStepsGoal}) = 'integer' and ${t.dailyStepsGoal} between 1 and 9007199254740991)`,
    ),
  ],
);
