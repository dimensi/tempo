import 'server-only';
import type Database from 'better-sqlite3';
import { getDatabase } from '@/server/db';
import { transformMateCatalogSchema } from '@/server/transformmate/catalog-schema';
import {
  persistedDetailSchema,
  type PersistedDetail,
  type Summary,
} from '@/server/transformmate/catalog-projection';
import { transformMateMuscleGroupInfoSchema } from '@/contracts/transformmate';
import { z } from 'zod';
export type CatalogIdentity = {
  ownerId: string;
  accountScope: string;
  locale: 'ru';
};
const WHERE = 'owner_id=? AND account_scope=? AND locale=?';
function values(scope: CatalogIdentity) {
  return [scope.ownerId, scope.accountScope, scope.locale];
}
export function createCatalogStore(sqlite: Database.Database) {
  function state(scope: CatalogIdentity) {
    return sqlite
      .prepare(`SELECT * FROM transformmate_catalog_state WHERE ${WHERE}`)
      .get(...values(scope)) as
      | {
          dictionary: string | null;
          dictionary_fetched_at: string | null;
          full_catalog_fetched_at: string | null;
          full_catalog_count: number | null;
        }
      | undefined;
  }
  type Row = {
    exercise_id: number;
    summary: string;
    summary_fetched_at: string;
    detail: string | null;
    detail_fetched_at: string | null;
    in_full_catalog: number;
  };
  function decode(r: Row) {
    return {
      id: r.exercise_id,
      summary: transformMateCatalogSchema.element.parse(JSON.parse(r.summary)),
      fetchedAt: r.summary_fetched_at,
      detail: r.detail
        ? persistedDetailSchema.parse(JSON.parse(r.detail))
        : null,
      detailFetchedAt: r.detail_fetched_at,
      inFullCatalog: Boolean(r.in_full_catalog),
    };
  }
  function record(scope: CatalogIdentity, id: number) {
    const row = sqlite
      .prepare(
        `SELECT * FROM transformmate_catalog_exercise WHERE ${WHERE} AND exercise_id=?`,
      )
      .get(...values(scope), id) as Row | undefined;
    return row ? decode(row) : null;
  }
  function records(scope: CatalogIdentity, fullOnly = false) {
    return (
      sqlite
        .prepare(
          `SELECT * FROM transformmate_catalog_exercise WHERE ${WHERE}${fullOnly ? ' AND in_full_catalog=1' : ''} ORDER BY exercise_id LIMIT 10000`,
        )
        .all(...values(scope)) as Row[]
    ).map(decode);
  }
  function upsert(
    scope: CatalogIdentity,
    summary: Summary,
    at: string,
    full: boolean,
  ) {
    sqlite
      .prepare(
        `INSERT INTO transformmate_catalog_exercise (owner_id,account_scope,locale,exercise_id,summary,summary_fetched_at,in_full_catalog) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,account_scope,locale,exercise_id) DO UPDATE SET summary=excluded.summary,summary_fetched_at=excluded.summary_fetched_at,in_full_catalog=MAX(in_full_catalog,excluded.in_full_catalog)`,
      )
      .run(
        ...values(scope),
        summary.id,
        JSON.stringify(summary),
        at,
        Number(full),
      );
  }
  function ensure(scope: CatalogIdentity) {
    sqlite
      .prepare(
        'INSERT OR IGNORE INTO transformmate_catalog_state (owner_id,account_scope,locale) VALUES (?,?,?)',
      )
      .run(...values(scope));
  }
  return {
    state,
    records,
    offlineRecords(scope: CatalogIdentity) {
      return (
        sqlite
          .prepare(
            `SELECT * FROM transformmate_catalog_exercise WHERE ${WHERE}
        ORDER BY coalesce(detail_fetched_at,summary_fetched_at) DESC,exercise_id LIMIT 201`,
          )
          .all(...values(scope)) as Row[]
      ).map(decode);
    },
    record,
    full(scope: CatalogIdentity, summaries: Summary[], at: string) {
      const parsed = transformMateCatalogSchema.parse(summaries);
      if (new Set(parsed.map((summary) => summary.id)).size !== parsed.length)
        throw new Error('Duplicate catalog IDs');
      sqlite.transaction(() => {
        ensure(scope);
        sqlite
          .prepare(
            `UPDATE transformmate_catalog_exercise SET in_full_catalog=0 WHERE ${WHERE}`,
          )
          .run(...values(scope));
        for (const summary of parsed) upsert(scope, summary, at, true);
        sqlite
          .prepare(
            `UPDATE transformmate_catalog_state SET full_catalog_fetched_at=?,full_catalog_count=? WHERE ${WHERE}`,
          )
          .run(at, parsed.length, ...values(scope));
      })();
    },
    detail(scope: CatalogIdentity, detail: PersistedDetail, at: string) {
      const parsed = persistedDetailSchema.parse(detail);
      sqlite.transaction(() => {
        ensure(scope);
        upsert(
          scope,
          {
            id: parsed.id,
            name: parsed.name,
            metrics: parsed.metrics.map(({ id, key }) => ({ id, key })),
          },
          at,
          false,
        );
        sqlite
          .prepare(
            `UPDATE transformmate_catalog_exercise SET detail=?,detail_fetched_at=? WHERE ${WHERE} AND exercise_id=?`,
          )
          .run(JSON.stringify(parsed), at, ...values(scope), parsed.id);
      })();
    },
    preview(
      scope: CatalogIdentity,
      id: number,
      expectedAt: string,
      image: string | null,
      coverage: 'available' | 'unknown',
      checkedAt: string,
    ) {
      sqlite.transaction(() => {
        const current = record(scope, id);
        if (
          !current?.detail ||
          current.detailFetchedAt !== expectedAt ||
          current.detail.image !== image
        )
          return;
        sqlite
          .prepare(
            `UPDATE transformmate_catalog_exercise SET detail=? WHERE ${WHERE} AND exercise_id=?`,
          )
          .run(
            JSON.stringify({
              ...current.detail,
              previewCoverage: coverage,
              previewCheckedAt: checkedAt,
            }),
            ...values(scope),
            id,
          );
      })();
    },
    dictionary(
      scope: CatalogIdentity,
      groups: z.infer<typeof transformMateMuscleGroupInfoSchema>[],
      at: string,
    ) {
      const parsed = z
        .array(transformMateMuscleGroupInfoSchema)
        .max(1000)
        .parse(groups);
      sqlite.transaction(() => {
        ensure(scope);
        sqlite
          .prepare(
            `UPDATE transformmate_catalog_state SET dictionary=?,dictionary_fetched_at=? WHERE ${WHERE}`,
          )
          .run(JSON.stringify(parsed), at, ...values(scope));
      })();
    },
  };
}
export function catalogStore() {
  return createCatalogStore(getDatabase().sqlite);
}
