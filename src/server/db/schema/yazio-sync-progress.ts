import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

export const yazioSyncProgress = sqliteTable(
  'yazio_sync_progress',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    food: integer('food', { mode: 'boolean' }).notNull().default(false),
    photos: integer('photos', { mode: 'boolean' }).notNull().default(false),
    steps: integer('steps', { mode: 'boolean' }).notNull().default(false),
    weight: integer('weight', { mode: 'boolean' }).notNull().default(false),
    body: integer('body', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.date] })],
);
