import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, desc, gte, lte, or, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { getDatabase } from '@/server/db';
import { workoutTransformMateNative as rows } from '@/server/db/schema/transformmate-native';
import {
  transformMateNativeSnapshotSchema,
  transformMateNativeItemSchema,
  transformMateNativeQuerySchema,
  type TransformMateNativeSnapshot,
} from '@/contracts/transformmate-native';

export function nativeCursor(date: string, remoteTrainingId: number) {
  return `${date}:${remoteTrainingId}`;
}
export function parseNativeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(cursor);
  if (!match) throw new Error('Invalid native cursor');
  return {
    date: z.iso.date().parse(match[1]),
    id: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(Number(match[2])),
  };
}
export function nativeRepository(
  db: Pick<
    ReturnType<typeof getDatabase>['db'],
    'select' | 'insert' | 'update'
  >,
) {
  const scope = (ownerId: string, accountScope: string) => {
    z.string().min(1).max(128).parse(ownerId);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(accountScope);
    return and(eq(rows.ownerId, ownerId), eq(rows.accountScope, accountScope));
  };
  const decode = (row: typeof rows.$inferSelect) => {
    if (Buffer.byteLength(row.snapshot, 'utf8') > 1024 * 1024)
      throw new Error('Invalid native snapshot');
    const snapshot = transformMateNativeSnapshotSchema.parse(
      JSON.parse(row.snapshot),
    );
    if (
      snapshot.date !== row.date ||
      snapshot.remoteTrainingId !== row.remoteTrainingId ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1
    )
      throw new Error('Invalid native snapshot');
    return transformMateNativeItemSchema.parse({
      ...snapshot,
      fetchedAt: row.fetchedAt,
    });
  };
  return {
    list(
      ownerId: string,
      accountScope: string,
      input: unknown,
      excluded: ReadonlySet<number> = new Set(),
    ) {
      const query = transformMateNativeQuerySchema.parse(input);
      const cursor = parseNativeCursor(query.cursor);
      // Exclusions happen before pagination so linked recovery cannot create duplicate cards.
      const found = db
        .select()
        .from(rows)
        .where(
          and(
            scope(ownerId, accountScope),
            gte(rows.date, query.from),
            lte(rows.date, query.to),
            cursor
              ? or(
                  lt(rows.date, cursor.date),
                  and(
                    eq(rows.date, cursor.date),
                    lt(rows.remoteTrainingId, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(rows.date), desc(rows.remoteTrainingId))
        .all()
        .filter((row) => !excluded.has(row.remoteTrainingId));
      const page = found.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(decode),
        nextCursor:
          found.length > query.limit && last
            ? nativeCursor(last.date, last.remoteTrainingId)
            : null,
      };
    },
    save(
      ownerId: string,
      accountScope: string,
      input: TransformMateNativeSnapshot,
      fetchedAt: string,
    ) {
      const snapshot = transformMateNativeSnapshotSchema.parse(input);
      z.iso.datetime({ offset: true }).parse(fetchedAt);
      const encoded = JSON.stringify(snapshot);
      if (Buffer.byteLength(encoded, 'utf8') > 1024 * 1024)
        throw new Error('Invalid native snapshot');
      const where = and(
        scope(ownerId, accountScope),
        eq(rows.remoteTrainingId, snapshot.remoteTrainingId),
      );
      const current = db.select().from(rows).where(where).get();
      if (current) {
        decode(current);
        if (current.revision === Number.MAX_SAFE_INTEGER)
          throw new Error('Invalid native revision');
        return (
          db
            .update(rows)
            .set({
              snapshot: encoded,
              date: snapshot.date,
              fetchedAt,
              updatedAt: fetchedAt,
              revision: current.revision + 1,
            })
            .where(and(where, eq(rows.revision, current.revision)))
            .returning()
            .get() !== undefined
        );
      }
      return (
        db
          .insert(rows)
          .values({
            id: randomUUID(),
            ownerId,
            accountScope,
            remoteTrainingId: snapshot.remoteTrainingId,
            date: snapshot.date,
            snapshot: encoded,
            fetchedAt,
            createdAt: fetchedAt,
            updatedAt: fetchedAt,
          })
          .onConflictDoNothing()
          .returning()
          .get() !== undefined
      );
    },
  };
}
export type NativeRepository = ReturnType<typeof nativeRepository>;
