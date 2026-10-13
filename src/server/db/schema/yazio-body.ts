import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from '@/server/db/schema';
import { measurements } from '@/server/db/schema/measurements';
import type { BodyMetric } from '@/contracts/yazio-body';
export const yazioBodyLinks = sqliteTable(
  'yazio_body_links',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    providerId: text('provider_id').notNull(),
    measurementId: text('measurement_id').references(() => measurements.id, {
      onDelete: 'set null',
    }),
    metric: text('metric').$type<BodyMetric>().notNull(),
    providerDateTime: text('provider_date_time').notNull(),
    syncedValue: text('synced_value'),
    remoteValue: text('remote_value'),
  },
  (t) => [
    uniqueIndex('yazio_body_provider_unique').on(
      t.ownerId,
      t.epoch,
      t.providerId,
    ),
    check('yazio_body_epoch_check', sql`${t.epoch} >= 0`),
    check(
      'yazio_body_metric_check',
      sql`${t.metric} in ('weight','waist','hips','chest','thigh','biceps')`,
    ),
    check(
      'yazio_body_uuid_check',
      sql`length(${t.providerId})=36 and substr(${t.providerId},9,1)='-' and substr(${t.providerId},14,1)='-' and substr(${t.providerId},19,1)='-' and substr(${t.providerId},24,1)='-'`,
    ),
    index('yazio_body_measurement_idx').on(
      t.ownerId,
      t.measurementId,
      t.metric,
    ),
  ],
);
export const yazioBodyOutbox = sqliteTable(
  'yazio_body_outbox',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    linkId: text('link_id')
      .notNull()
      .references(() => yazioBodyLinks.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    value: text('value').notNull(),
    baseline: text('baseline'),
    conflictValue: text('conflict_value'),
    state: text('state', {
      enum: [
        'pending',
        'sending',
        'uncertain',
        'failed',
        'conflict',
        'done',
        'cancelled',
      ],
    }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('yazio_body_job_revision_unique').on(t.linkId, t.revision),
    check('yazio_body_revision_check', sql`${t.revision} > 0`),
    check('yazio_body_outbox_epoch_check', sql`${t.epoch} >= 0`),
    check('yazio_body_outbox_attempt_check', sql`${t.attempt} >= 0`),
    check(
      'yazio_body_state_check',
      sql`${t.state} in ('pending','sending','uncertain','failed','conflict','done','cancelled')`,
    ),
    index('yazio_body_due_idx').on(
      t.ownerId,
      t.epoch,
      t.state,
      t.nextAttemptAt,
    ),
    index('yazio_body_link_jobs_idx').on(t.linkId, t.createdAt),
  ],
);
