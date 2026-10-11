import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

export const nutritionDays = sqliteTable(
  'nutrition_days',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    snapshot: text('snapshot').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.date] })],
);
export const nutritionCache = sqliteTable(
  'nutrition_cache',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['product', 'recipe'] }).notNull(),
    id: text('id').notNull(),
    payload: text('payload').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.kind, t.id] })],
);
export const nutritionSyncRuns = sqliteTable('nutrition_sync_runs', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
});
