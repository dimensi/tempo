import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
export const trainerInvitations = sqliteTable(
  'trainer_invitations',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('trainer_invitation_owner_idx').on(t.ownerId)],
);
