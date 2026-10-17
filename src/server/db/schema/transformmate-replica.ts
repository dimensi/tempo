import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
const scope = () => ({
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountScope: text('account_scope').notNull(),
  locale: text('locale').notNull(),
});
export const transformMateReplicaState = sqliteTable(
  'transformmate_replica_state',
  {
    ...scope(),
    nextRequestAt: integer('next_request_at').notNull().default(0),
    blockedUntil: integer('blocked_until').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    reason: text('reason'),
    connectionId: text('connection_id'),
    lastSuccessAt: integer('last_success_at'),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.accountScope, t.locale] })],
);
export const transformMateReplicaJobs = sqliteTable(
  'transformmate_replica_jobs',
  {
    ...scope(),
    key: text('key').notNull(),
    nextAt: integer('next_at').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    data: text('data').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.accountScope, t.locale, t.key] }),
    index('tm_replica_due_idx').on(
      t.ownerId,
      t.accountScope,
      t.locale,
      t.nextAt,
      t.priority,
    ),
  ],
);
export const transformMateReplicaGarbage = sqliteTable(
  'transformmate_replica_garbage',
  {
    key: text('key').primaryKey(),
    nextAt: integer('next_at').notNull().default(0),
  },
);
