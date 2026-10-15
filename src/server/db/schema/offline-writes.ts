import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
export const offlineWriteReceipts = sqliteTable(
  'offline_write_receipts',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: text('result').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.operationId] })],
);
