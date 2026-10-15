import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { offlineWriteReceipts } from '@/server/db/schema/offline-writes';
import { measurements } from '@/server/db/schema/measurements';
import { workoutSessions, workoutPlans } from '@/server/db/schema/workouts';
import { measurementInputSchema } from '@/contracts/measurements';
import { workoutSessionInputSchema } from '@/contracts/workouts';
import {
  writeRecordSchema,
  type OfflineWrite,
  type WriteRecord,
} from '@/contracts/offline-write';
import { bodyRepository } from '@/server/yazio/body-repository';
import { workoutRepository } from '@/server/workouts/repository';
export class OfflineWriteError extends Error {
  constructor(public status: number) {
    super('Offline write failed');
  }
}
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function offlineWriteRepository(database = getDatabase()) {
  const { db, sqlite } = database;
  function find(
    ownerId: string,
    id: string,
    kind: OfflineWrite['payload']['kind'],
  ): WriteRecord | null {
    if (kind === 'measurement') {
      const row = db
        .select()
        .from(measurements)
        .where(and(eq(measurements.ownerId, ownerId), eq(measurements.id, id)))
        .get();
      if (!row) return null;
      const data = measurementInputSchema.parse({
        measuredAt: row.measuredAt,
        values: row.values,
        note: row.note,
      });
      return { id, version: fingerprint(data), payload: { kind, data } };
    }
    const row = db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.id, id)),
      )
      .get();
    return row
      ? {
          id,
          version: String(row.revision),
          payload: {
            kind,
            data: workoutSessionInputSchema.parse({
              date: row.data.date,
              title: row.data.title,
              exercises: row.data.exercises,
              note: row.data.note,
              status: row.data.status,
            }),
          },
        }
      : null;
  }
  return {
    catalog(ownerId: string) {
      const ids = [
        ...db
          .select({ id: measurements.id })
          .from(measurements)
          .where(eq(measurements.ownerId, ownerId))
          .limit(501)
          .all()
          .map((r) => ({ ...r, kind: 'measurement' as const })),
        ...db
          .select({ id: workoutSessions.id })
          .from(workoutSessions)
          .where(eq(workoutSessions.ownerId, ownerId))
          .limit(501)
          .all()
          .map((r) => ({ ...r, kind: 'workout' as const })),
      ];
      if (
        ids.filter((r) => r.kind === 'measurement').length > 500 ||
        ids.filter((r) => r.kind === 'workout').length > 500
      )
        throw new OfflineWriteError(413);
      return ids.flatMap((r) => {
        const record = find(ownerId, r.id, r.kind);
        return record ? [record] : [];
      });
    },
    apply(ownerId: string, operation: OfflineWrite) {
      return sqlite.transaction(() => {
        const hash = fingerprint(operation);
        const receipt = db
          .select()
          .from(offlineWriteReceipts)
          .where(
            and(
              eq(offlineWriteReceipts.ownerId, ownerId),
              eq(offlineWriteReceipts.operationId, operation.id),
            ),
          )
          .get();
        if (receipt) {
          if (receipt.fingerprint !== hash) throw new OfflineWriteError(409);
          return writeRecordSchema.parse(JSON.parse(receipt.result));
        }
        if (
          operation.payload.kind === 'measurement' &&
          operation.yazioEpoch !==
            (bodyRepository(database).schedule(ownerId)?.epoch ?? null)
        )
          throw new OfflineWriteError(409);
        const previous = find(
          ownerId,
          operation.recordId,
          operation.payload.kind,
        );
        if ((previous?.version ?? null) !== operation.base)
          throw new OfflineWriteError(409);
        const { payload, recordId } = operation;
        if (payload.kind === 'measurement') {
          if (previous)
            db.update(measurements)
              .set(payload.data)
              .where(
                and(
                  eq(measurements.ownerId, ownerId),
                  eq(measurements.id, recordId),
                ),
              )
              .run();
          else
            db.insert(measurements)
              .values({ id: recordId, ownerId, ...payload.data })
              .run();
          // The existing provider outbox reconciles an ambiguous write before any retry.
          bodyRepository(database).enqueue(
            ownerId,
            recordId,
            payload.data,
            previous?.payload.kind === 'measurement'
              ? previous.payload.data
              : null,
          );
        } else if (previous?.payload.kind === 'workout') {
          // Offline result edits cannot remove occurrences that may own private videos.
          const before = previous.payload.data.exercises
            .map((e) => e.id)
            .sort();
          const after = payload.data.exercises.map((e) => e.id).sort();
          if (JSON.stringify(before) !== JSON.stringify(after))
            throw new OfflineWriteError(422);
          const actual = workoutSessionInputSchema.parse({
            date: payload.data.date,
            title: payload.data.title,
            exercises: payload.data.exercises,
            note: payload.data.note,
            status: payload.data.status,
          });
          workoutRepository(db).updateSession(
            ownerId,
            recordId,
            Number(previous.version),
            actual,
          );
        } else {
          if (payload.data.planId) {
            const plan = db
              .select()
              .from(workoutPlans)
              .where(
                and(
                  eq(workoutPlans.ownerId, ownerId),
                  eq(workoutPlans.id, payload.data.planId),
                ),
              )
              .get();
            if (!plan || plan.revision !== payload.planRevision)
              throw new OfflineWriteError(409);
          }
          workoutRepository(db).createSession(ownerId, payload.data, recordId);
        }
        const result = find(ownerId, recordId, payload.kind)!;
        db.insert(offlineWriteReceipts)
          .values({
            ownerId,
            operationId: operation.id,
            fingerprint: hash,
            result: JSON.stringify(result),
          })
          .run();
        return result;
      })();
    },
  };
}
