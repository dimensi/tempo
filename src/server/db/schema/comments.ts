import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    targetType: text('target_type', {
      enum: ['nutrition_day', 'measurement', 'workout'],
    }).notNull(),
    targetId: text('target_id').notNull(),
    parentId: text('parent_id'),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('comments_target_idx').on(t.ownerId, t.targetType, t.targetId)],
);
