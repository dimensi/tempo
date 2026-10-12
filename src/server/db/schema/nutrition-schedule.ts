import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from '@/server/db/schema';

export const nutritionSchedule = sqliteTable(
  'nutrition_schedule',
  {
    ownerId: text('owner_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    timezone: text('timezone').notNull().default('UTC'),
    initialFrom: text('initial_from'),
    epoch: integer('epoch').notNull().default(0),
    lastSuccess: integer('last_success'),
    lastError: text('last_error', {
      enum: ['NOT_CONFIGURED', 'SYNC_FAILED', 'PHOTO_INCOMPLETE', 'LEASE_LOST'],
    }),
    nextRunAt: integer('next_run_at'),
    attempt: integer('attempt').notNull().default(0),
    leaseId: text('lease_id'),
    leaseExpiresAt: integer('lease_expires_at'),
    leaseStartedAt: integer('lease_started_at'),
  },
  (t) => [
    index('nutrition_schedule_due_idx').on(t.enabled, t.nextRunAt),
    check('nutrition_schedule_attempt', sql`${t.attempt} between 0 and 3`),
  ],
);
