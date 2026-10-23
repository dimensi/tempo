import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

export const yazioWeightEntries = sqliteTable(
  'yazio_weight_entries',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    providerDate: text('provider_date').notNull(),
    measuredDate: text('measured_date'),
    rawValue: text('raw_value'),
    unit: text('unit').$type<null>(),
    unitContext: text('unit_context'),
    upstreamSource: text('upstream_source'),
    gateway: text('gateway'),
    observedAt: text('observed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.externalId] }),
    index('yazio_weight_owner_date_idx').on(t.ownerId, t.measuredDate),
    check(
      'yazio_weight_external_id_check',
      sql`length(${t.externalId}) = 36 and ${t.externalId} = lower(${t.externalId})`,
    ),
    check(
      'yazio_weight_provider_date_check',
      sql`length(${t.providerDate}) between 1 and 128`,
    ),
    check(
      'yazio_weight_measured_date_check',
      sql`${t.measuredDate} is null or ${t.measuredDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check('yazio_weight_unit_unknown_check', sql`${t.unit} is null`),
    check(
      'yazio_weight_context_check',
      sql`${t.unitContext} is null or length(${t.unitContext}) <= 128`,
    ),
    check(
      'yazio_weight_source_check',
      sql`${t.upstreamSource} is null or length(${t.upstreamSource}) <= 128`,
    ),
    check(
      'yazio_weight_gateway_check',
      sql`${t.gateway} is null or length(${t.gateway}) <= 128`,
    ),
  ],
);

export const yazioDailySteps = sqliteTable(
  'yazio_daily_steps',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    steps: integer('steps'),
    observedAt: text('observed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.date] }),
    check(
      'yazio_steps_date_check',
      sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      'yazio_steps_count_check',
      sql`${t.steps} is null or (typeof(${t.steps}) = 'integer' and ${t.steps} between 0 and 9007199254740991)`,
    ),
  ],
);

export const yazioDailyGoals = sqliteTable(
  'yazio_daily_goals',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    calories: text('calories'),
    steps: integer('steps'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.date] }),
    check(
      'yazio_goals_steps_check',
      sql`${t.steps} is null or (typeof(${t.steps}) = 'integer' and ${t.steps} between 1 and 9007199254740991)`,
    ),
  ],
);
