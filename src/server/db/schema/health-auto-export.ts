import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import {
  healthAutoExportErrorCodes,
  healthAutoExportMetrics,
  healthAutoExportSleepStages,
  type HealthAutoExportSample,
} from '@/contracts/health-auto-export';
import { user } from '@/server/db/schema';

export const healthAutoExportConnections = sqliteTable(
  'health_auto_export_connections',
  {
    ownerId: text('owner_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').unique(),
    lastAttemptAt: text('last_attempt_at'),
    lastSuccessAt: text('last_success_at'),
    lastInserted: integer('last_inserted'),
    lastErrorAt: text('last_error_at'),
    lastErrorCode: text('last_error_code', {
      enum: healthAutoExportErrorCodes,
    }),
  },
  (table) => [
    check(
      'health_auto_export_token_digest_length',
      sql`${table.tokenDigest} is null or length(${table.tokenDigest}) = 64`,
    ),
  ],
);

export const healthAutoExportSamples = sqliteTable(
  'health_auto_export_samples',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sampleKey: text('sample_key').notNull(),
    metric: text('metric', { enum: healthAutoExportMetrics }).notNull(),
    source: text('source'),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    startOffsetMinutes: integer('start_offset_minutes').notNull(),
    endOffsetMinutes: integer('end_offset_minutes').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    stage: text('stage', { enum: healthAutoExportSleepStages }),
    value: real('value'),
    unit: text('unit').$type<HealthAutoExportSample['unit']>().notNull(),
    min: real('min'),
    max: real('max'),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.sampleKey] }),
    index('health_auto_export_sample_owner_local_date').on(
      table.ownerId,
      table.endDate,
      table.startDate,
    ),
    check(
      'health_auto_export_sample_bounds',
      sql`${table.endAt} >= ${table.startAt}`,
    ),
  ],
);
