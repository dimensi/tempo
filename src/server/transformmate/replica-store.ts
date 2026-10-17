import 'server-only';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getDatabase } from '@/server/db';
import type { CatalogIdentity } from './catalog-store';

const objectSchema = z.object({
  key: z.string(),
  size: z.number().int().nonnegative(),
  type: z.string(),
  fingerprint: z.string(),
  etag: z.string().nullable(),
  modified: z.string().nullable(),
});
export type ReplicaObject = z.infer<typeof objectSchema>;
export const replicaDataSchema = z.object({
  detailAt: z.number().default(0),
  imageAt: z.number().default(0),
  videoAt: z.number().default(0),
  posterAt: z.number().default(0),
  image: objectSchema.nullable().default(null),
  video: objectSchema.nullable().default(null),
  poster: objectSchema.nullable().default(null),
});
export type ReplicaData = z.infer<typeof replicaDataSchema>;
export type ReplicaJob = {
  key: string;
  next_at: number;
  priority: number;
  attempts: number;
  error: string | null;
  data: ReplicaData;
};
export type ReplicaState = {
  next_request_at: number;
  blocked_until: number;
  failures: number;
  reason: string | null;
  connection_id: string | null;
  last_success_at: number | null;
};
export const monthFrom = (now: number, random = Math.random) =>
  Math.floor(now + (25 + random() * 10) * 86400000);
const where = 'owner_id=? AND account_scope=? AND locale=?';
const values = (s: CatalogIdentity) => [s.ownerId, s.accountScope, s.locale];
export function createReplicaStore(sqlite: Database.Database) {
  function ensure(s: CatalogIdentity) {
    sqlite
      .prepare(
        'INSERT OR IGNORE INTO transformmate_replica_state(owner_id,account_scope,locale) VALUES(?,?,?)',
      )
      .run(...values(s));
  }
  function state(s: CatalogIdentity) {
    ensure(s);
    return sqlite
      .prepare(`SELECT * FROM transformmate_replica_state WHERE ${where}`)
      .get(...values(s)) as ReplicaState;
  }
  function patch(s: CatalogIdentity, input: Partial<ReplicaState>) {
    ensure(s);
    const keys = Object.keys(input) as (keyof ReplicaState)[];
    if (keys.length)
      sqlite
        .prepare(
          `UPDATE transformmate_replica_state SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${where}`,
        )
        .run(...keys.map((k) => input[k]!), ...values(s));
  }
  function decode(
    row: Omit<ReplicaJob, 'data'> & { data: string },
  ): ReplicaJob {
    return { ...row, data: replicaDataSchema.parse(JSON.parse(row.data)) };
  }
  function job(s: CatalogIdentity, key: string) {
    const row = sqlite
      .prepare(
        `SELECT * FROM transformmate_replica_jobs WHERE ${where} AND key=?`,
      )
      .get(...values(s), key) as
      (Omit<ReplicaJob, 'data'> & { data: string }) | undefined;
    return row ? decode(row) : null;
  }
  function enqueue(s: CatalogIdentity, key: string, nextAt = 0, priority = 0) {
    sqlite
      .prepare(
        `INSERT INTO transformmate_replica_jobs(owner_id,account_scope,locale,key,next_at,priority,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,account_scope,locale,key) DO UPDATE SET priority=MAX(priority,excluded.priority)`,
      )
      .run(
        ...values(s),
        key,
        nextAt,
        priority,
        JSON.stringify(replicaDataSchema.parse({})),
      );
  }
  function save(s: CatalogIdentity, j: ReplicaJob) {
    sqlite
      .prepare(
        `UPDATE transformmate_replica_jobs SET next_at=?,priority=?,attempts=?,error=?,data=? WHERE ${where} AND key=?`,
      )
      .run(
        j.next_at,
        j.priority,
        j.attempts,
        j.error,
        JSON.stringify(replicaDataSchema.parse(j.data)),
        ...values(s),
        j.key,
      );
  }
  function bootstrap(s: CatalogIdentity) {
    sqlite.transaction(() => {
      ensure(s);
      const previous = sqlite
        .prepare(
          `SELECT full_catalog_fetched_at,dictionary_fetched_at FROM transformmate_catalog_state WHERE ${where}`,
        )
        .get(...values(s)) as
        | {
            full_catalog_fetched_at: string | null;
            dictionary_fetched_at: string | null;
          }
        | undefined;
      enqueue(
        s,
        'catalog',
        previous?.full_catalog_fetched_at
          ? monthFrom(Date.parse(previous.full_catalog_fetched_at))
          : 0,
      );
      enqueue(
        s,
        'dictionary',
        previous?.dictionary_fetched_at
          ? monthFrom(Date.parse(previous.dictionary_fetched_at))
          : 0,
      );
      const rows = sqlite
        .prepare(
          `SELECT exercise_id,detail_fetched_at,detail FROM transformmate_catalog_exercise WHERE ${where}`,
        )
        .all(...values(s)) as {
        exercise_id: number;
        detail: string | null;
        detail_fetched_at: string | null;
      }[];
      for (const row of rows) {
        const key = `exercise:${row.exercise_id}`;
        if (job(s, key)) continue;
        enqueue(s, key);
        if (
          row.detail_fetched_at &&
          row.detail &&
          JSON.parse(row.detail).videoMetadataComplete
        ) {
          const j = job(s, key)!;
          j.data.detailAt = monthFrom(Date.parse(row.detail_fetched_at));
          save(s, j);
        }
      }
    })();
  }
  function next(s: CatalogIdentity, now: number) {
    const row = sqlite
      .prepare(
        `SELECT * FROM transformmate_replica_jobs WHERE ${where} AND next_at<=? ORDER BY CASE WHEN key='catalog' THEN 0 WHEN key='dictionary' THEN 1 ELSE 2 END, priority DESC,next_at,key LIMIT 1`,
      )
      .get(...values(s), now) as
      (Omit<ReplicaJob, 'data'> & { data: string }) | undefined;
    return row ? decode(row) : null;
  }
  function garbage(key: string, now: number) {
    sqlite
      .prepare(
        'INSERT OR IGNORE INTO transformmate_replica_garbage(key,next_at) VALUES(?,?)',
      )
      .run(key, now);
  }
  return {
    state,
    patch,
    job,
    enqueue,
    save,
    bootstrap,
    next,
    garbage,
    publish(
      s: CatalogIdentity,
      j: ReplicaJob,
      kind: 'video' | 'image' | 'poster',
      object: ReplicaObject,
      now: number,
    ) {
      sqlite.transaction(() => {
        const previous = j.data[kind];
        j.data[kind] = object;
        save(s, j);
        if (previous && previous.key !== object.key) garbage(previous.key, now);
      })();
    },
    garbageDue(now: number) {
      return sqlite
        .prepare(
          'SELECT key FROM transformmate_replica_garbage WHERE next_at<=? LIMIT 10',
        )
        .all(now) as { key: string }[];
    },
    garbageDone(key: string) {
      sqlite
        .prepare('DELETE FROM transformmate_replica_garbage WHERE key=?')
        .run(key);
    },
    garbageRetry(key: string, now: number) {
      sqlite
        .prepare(
          'UPDATE transformmate_replica_garbage SET next_at=? WHERE key=?',
        )
        .run(now + 3600000, key);
    },
    isReferenced(key: string) {
      return Boolean(
        sqlite
          .prepare(
            "SELECT 1 FROM transformmate_replica_jobs WHERE json_extract(data,'$.video.key')=? OR json_extract(data,'$.image.key')=? OR json_extract(data,'$.poster.key')=? LIMIT 1",
          )
          .get(key, key, key),
      );
    },
    status(s: CatalogIdentity, now: number) {
      const jobs = (
        sqlite
          .prepare(
            `SELECT * FROM transformmate_replica_jobs WHERE ${where} AND key LIKE 'exercise:%'`,
          )
          .all(...values(s)) as (Omit<ReplicaJob, 'data'> & { data: string })[]
      ).map(decode);
      const count = sqlite
        .prepare(
          `SELECT count(*) AS total, count(detail) AS n FROM transformmate_catalog_exercise WHERE ${where}`,
        )
        .get(...values(s)) as { n: number; total: number };
      const nextAt = sqlite
        .prepare(
          `SELECT min(next_at) AS at FROM transformmate_replica_jobs WHERE ${where}`,
        )
        .get(...values(s)) as { at: number | null };
      return {
        total: Math.max(jobs.length, count.total),
        descriptions: count.n,
        videos: jobs.filter((j) => j.data.video).length,
        previews: jobs.filter((j) => j.data.poster || j.data.image).length,
        bytes: jobs.reduce(
          (n, j) =>
            n +
            (j.data.video?.size ?? 0) +
            (j.data.image?.size ?? 0) +
            (j.data.poster?.size ?? 0),
          0,
        ),
        pending: jobs.filter((j) => j.next_at <= now).length,
        errors: jobs.filter((j) => j.error).length,
        failedExercises: jobs
          .filter((j) => j.error)
          .slice(0, 5)
          .map((j) => ({
            id: Number(j.key.slice('exercise:'.length)),
            reason: j.error,
            nextAttemptAt: new Date(j.next_at).toISOString(),
          })),
        nextAt: nextAt.at,
        state: state(s),
      };
    },
  };
}
export const replicaStore = () => createReplicaStore(getDatabase().sqlite);
