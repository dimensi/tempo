import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

// Token refresh preserves connectionId; account replacement/disconnection fences
// old generations. No credentials or public media URLs belong in public DTOs.
function scopeColumns() {
  return {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountScope: text('account_scope').notNull(),
    generation: text('generation').notNull(),
    locale: text('locale', { enum: ['ru'] }).notNull(),
  };
}

export const transformMateCatalogState = sqliteTable(
  'transformmate_catalog_state',
  {
    ...scopeColumns(),
    // Validated dictionary projection, not an invented taxonomy.
    dictionary: text('dictionary'),
    dictionaryFetchedAt: text('dictionary_fetched_at'),
    fullCatalogFetchedAt: text('full_catalog_fetched_at'),
    fullCatalogCount: integer('full_catalog_count'),
  },
  (t) => [
    primaryKey({
      columns: [t.ownerId, t.accountScope, t.generation, t.locale],
    }),
    check('tm_catalog_state_locale', sql`${t.locale} = 'ru'`),
    check(
      'tm_catalog_state_count',
      sql`${t.fullCatalogCount} is null or ${t.fullCatalogCount} between 0 and 10000`,
    ),
    check(
      'tm_catalog_state_dictionary_pair',
      sql`(${t.dictionary} is null) = (${t.dictionaryFetchedAt} is null)`,
    ),
    check(
      'tm_catalog_state_full_pair',
      sql`(${t.fullCatalogCount} is null) = (${t.fullCatalogFetchedAt} is null)`,
    ),
  ],
);

export const transformMateCatalogExercise = sqliteTable(
  'transformmate_catalog_exercise',
  {
    ...scopeColumns(),
    exerciseId: integer('exercise_id').notNull(),
    // Bounded Zod-validated summary/detail projections. Detail includes private
    // metadata URLs; never returned verbatim or fetched without proxy validation.
    summary: text('summary').notNull(),
    summaryFetchedAt: text('summary_fetched_at').notNull(),
    detail: text('detail'),
    detailFetchedAt: text('detail_fetched_at'),
    // Filtered-page upserts cannot join or complete the unfiltered catalog.
    inFullCatalog: integer('in_full_catalog', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (t) => [
    primaryKey({
      columns: [
        t.ownerId,
        t.accountScope,
        t.generation,
        t.locale,
        t.exerciseId,
      ],
    }),
    index('tm_catalog_exercise_full_idx').on(
      t.ownerId,
      t.accountScope,
      t.generation,
      t.locale,
      t.inFullCatalog,
    ),
    check('tm_catalog_exercise_id', sql`${t.exerciseId} > 0`),
    check('tm_catalog_exercise_locale', sql`${t.locale} = 'ru'`),
    check('tm_catalog_exercise_full', sql`${t.inFullCatalog} in (0, 1)`),
    check(
      'tm_catalog_exercise_detail_pair',
      sql`(${t.detail} is null) = (${t.detailFetchedAt} is null)`,
    ),
  ],
);

export const transformMateCatalogQuery = sqliteTable(
  'transformmate_catalog_query',
  {
    ...scopeColumns(),
    // Canonical normalized query + exact localized names + offset/limit.
    queryKey: text('query_key').notNull(),
    exerciseIds: text('exercise_ids').notNull(),
    total: integer('total').notNull(),
    hasMore: integer('has_more', { mode: 'boolean' }).notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.ownerId, t.accountScope, t.generation, t.locale, t.queryKey],
    }),
    index('tm_catalog_query_fetched_idx').on(
      t.ownerId,
      t.accountScope,
      t.generation,
      t.locale,
      t.fetchedAt,
    ),
    check('tm_catalog_query_total', sql`${t.total} >= 0`),
    check('tm_catalog_query_locale', sql`${t.locale} = 'ru'`),
    check('tm_catalog_query_more', sql`${t.hasMore} in (0, 1)`),
  ],
);
