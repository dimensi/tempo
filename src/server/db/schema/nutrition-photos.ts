import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

export const nutritionPhotos = sqliteTable(
  'nutrition_photos',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    daytime: text('daytime', {
      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
    }).notNull(),
    source: text('source', { enum: ['yazio', 'manual'] }).notNull(),
    storageKey: text('storage_key').notNull(),
    contentHash: text('content_hash').notNull(),
    sourceUrl: text('source_url'),
    observedAt: text('observed_at').notNull(),
    mime: text('mime').notNull(),
  },
  (t) => [
    uniqueIndex('nutrition_yazio_photo_slot')
      .on(t.ownerId, t.date, t.daytime)
      .where(sql`${t.source} = 'yazio'`),
    index('nutrition_photo_day').on(t.ownerId, t.date),
    check('nutrition_photo_source', sql`${t.source} in ('yazio', 'manual')`),
    check(
      'nutrition_photo_daytime',
      sql`${t.daytime} in ('breakfast', 'lunch', 'dinner', 'snack')`,
    ),
  ],
);
