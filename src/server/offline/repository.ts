import 'server-only';
import { yazioObservationDate } from '@/lib/yazio-observations';
import { z } from 'zod';
import { getDatabase } from '@/server/db';
import { offlineLimits } from '@/contracts/offline';
import { nutritionDaySchema } from '@/contracts/nutrition';
import { measurementInputSchema } from '@/contracts/measurements';
import {
  workoutPlanInputSchema,
  workoutSessionSchema,
} from '@/contracts/workouts';
import { transformMateNativeSnapshotSchema } from '@/contracts/transformmate-native';
import { transformMateActualSchema } from '@/contracts/transformmate';
import { OfflineError } from './errors';

const payloadLimit = 2 * 1024 * 1024;
const text = z.string();
const id = text.min(1);
const stamp = z.iso.datetime({ offset: true });
const scalar = text.nullable();
const photoSchema = z.object({
  id,
  date: z.iso.date(),
  daytime: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  source: z.enum(['manual', 'yazio']),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  observedAt: stamp,
});
const jsonRow = z.object({ id, payload: text.nullable() });

// Queries probe one extra row for overflow. Oversized JSON becomes NULL inside
// SQLite, so no truncated projection is returned. All reads are local only.
export function offlineRepository(database = getDatabase()) {
  const { sqlite } = database;
  let remainingBytes: number = offlineLimits.payloadBytes;
  function rows<T>(
    query: string,
    parameters: (string | number)[],
    limit: number,
    schema: z.ZodType<T>,
  ) {
    const result: unknown[] = [];
    for (const row of sqlite
      .prepare(query + ' LIMIT ?')
      .iterate(...parameters, limit + 1)) {
      remainingBytes -= Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (result.length === limit || remainingBytes < 0)
        throw new OfflineError(413, 'OFFLINE_LIMIT_EXCEEDED');
      result.push(row);
    }
    return z.array(schema).parse(result);
  }
  function parseJson<T>(value: string | null, schema: z.ZodType<T>) {
    if (value === null) throw new OfflineError(413, 'OFFLINE_LIMIT_EXCEEDED');
    return schema.parse(JSON.parse(value));
  }
  return {
    generation(ownerId: string) {
      const row = sqlite
        .prepare('SELECT epoch FROM nutrition_schedule WHERE owner_id = ?')
        .get(ownerId) as { epoch: number } | undefined;
      return row?.epoch ?? 0;
    },
    read(
      ownerId: string,
      from: string,
      to: string,
      accountScope: string | null = null,
    ) {
      remainingBytes = offlineLimits.payloadBytes;
      const args = [payloadLimit, ownerId, from, to];
      const diary = rows(
        'SELECT date, CASE WHEN length(CAST(snapshot AS BLOB)) <= ? THEN snapshot END AS payload FROM nutrition_days WHERE owner_id = ? AND date BETWEEN ? AND ? ORDER BY date',
        args,
        30,
        z.object({ date: z.iso.date(), payload: text.nullable() }),
      ).map((row) => {
        const value = parseJson(row.payload, nutritionDaySchema);
        if (value.date !== row.date)
          throw new OfflineError(503, 'OFFLINE_UNAVAILABLE');
        return value;
      });
      const photos = rows(
        'SELECT id,date,daytime,source,mime,observed_at AS observedAt FROM nutrition_photos WHERE owner_id = ? AND date BETWEEN ? AND ? ORDER BY date,id',
        [ownerId, from, to],
        offlineLimits.photos,
        photoSchema,
      );
      const measurements = rows(
        'SELECT id,measured_at AS measuredAt,CASE WHEN length(CAST(values_json AS BLOB)) <= ? THEN values_json END AS payload,note FROM measurements WHERE owner_id = ? AND measured_at BETWEEN ? AND ? ORDER BY measured_at,id',
        args,
        offlineLimits.measurements,
        jsonRow.extend({ measuredAt: z.iso.date(), note: scalar }),
      ).map((row) => ({
        id: row.id,
        ...measurementInputSchema.parse({
          measuredAt: row.measuredAt,
          note: row.note,
          values: parseJson(row.payload, z.array(z.unknown())),
        }),
      }));
      const weights = rows(
        'SELECT external_id AS id,provider_date AS providerDate,measured_date AS measuredDate,raw_value AS rawValue,unit,unit_context AS unitContext,observed_at AS observedAt FROM yazio_weight_entries WHERE owner_id = ? AND coalesce(measured_date,substr(provider_date,1,10)) BETWEEN ? AND ? ORDER BY coalesce(measured_date,substr(provider_date,1,10)),external_id',
        [ownerId, from, to],
        offlineLimits.weights,
        z.object({
          id,
          providerDate: text.max(128),
          measuredDate: z.iso.date().nullable(),
          rawValue: scalar,
          unit: z.null(),
          unitContext: scalar,
          observedAt: stamp,
        }),
      ).flatMap((row) => {
        const measuredDate = yazioObservationDate(
          row.measuredDate ?? row.providerDate,
        );
        return measuredDate ? [{ ...row, measuredDate }] : [];
      });
      const steps = rows(
        'SELECT date,steps,observed_at AS observedAt FROM yazio_daily_steps WHERE owner_id = ? AND date BETWEEN ? AND ? ORDER BY date',
        [ownerId, from, to],
        30,
        z.object({
          date: z.iso.date(),
          steps: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER)
            .nullable(),
          observedAt: stamp,
        }),
      );
      const plans = rows(
        "SELECT id,CASE WHEN length(CAST(data AS BLOB)) <= ? THEN data END AS payload FROM workout_plans WHERE owner_id = ? AND json_extract(data,'$.startsOn') <= ? AND json_extract(data,'$.endsOn') >= ? ORDER BY created_at,id",
        [payloadLimit, ownerId, to, from],
        offlineLimits.plans,
        jsonRow,
      ).map((row) => ({
        id: row.id,
        data: parseJson(row.payload, workoutPlanInputSchema),
      }));
      const sessions = rows(
        'SELECT id,date,CASE WHEN length(CAST(data AS BLOB)) <= ? THEN data END AS payload,revision,created_at AS createdAt,updated_at AS updatedAt FROM workout_sessions WHERE owner_id = ? AND date BETWEEN ? AND ? ORDER BY date,id',
        args,
        offlineLimits.sessions,
        jsonRow.extend({
          date: z.iso.date(),
          revision: z.number().int().positive(),
          createdAt: stamp,
          updatedAt: stamp,
        }),
      ).map((row) => {
        const session = workoutSessionSchema.parse({
          ...parseJson(row.payload, z.record(z.string(), z.unknown())),
          id: row.id,
          ownerId,
          revision: row.revision,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        if (session.date !== row.date)
          throw new OfflineError(503, 'OFFLINE_UNAVAILABLE');
        return session;
      });
      const transformMateFacts = rows(
        "SELECT id,plan_id AS planId,workout_id AS workoutId,remote_training_id AS remoteTrainingId,CASE WHEN length(CAST(CASE WHEN json_type(state,'$.published') = 'object' THEN json_extract(state,'$.published') WHEN json_type(state,'$.workout') = 'object' THEN json_object('planTitle',json_extract(state,'$.planTitle'),'workout',json(json_extract(state,'$.workout'))) END AS BLOB)) <= 2097152 THEN CASE WHEN json_type(state,'$.published') = 'object' THEN json_extract(state,'$.published') WHEN json_type(state,'$.workout') = 'object' THEN json_object('planTitle',json_extract(state,'$.planTitle'),'workout',json(json_extract(state,'$.workout'))) END END AS planSnapshot,CASE WHEN length(CAST(json_extract(state,'$.actual') AS BLOB)) <= ? THEN json_extract(state,'$.actual') END AS payload,json_extract(state,'$.checkedAt') AS checkedAt FROM workout_transformmate_links WHERE owner_id = ? AND json_extract(state,'$.actual.date') BETWEEN ? AND ? ORDER BY updated_at,id",
        args,
        offlineLimits.transformMateFacts,
        jsonRow.extend({
          checkedAt: stamp.nullable(),
          planId: id,
          workoutId: id,
          remoteTrainingId: z.number().int().positive().nullable(),
          planSnapshot: text.nullable(),
        }),
      ).map((row) => ({
        id: row.id,
        checkedAt: row.checkedAt,
        planId: row.planId,
        workoutId: row.workoutId,
        remoteTrainingId: row.remoteTrainingId,
        planSnapshot:
          row.planSnapshot === null
            ? null
            : parseJson(
                row.planSnapshot,
                z.object({
                  planTitle: text,
                  workout: workoutPlanInputSchema.shape.workouts.element,
                }),
              ),
        actual: parseJson(row.payload, transformMateActualSchema),
      }));
      const nativeTrainings =
        accountScope === null
          ? []
          : rows(
              'SELECT id,date,fetched_at AS fetchedAt,CASE WHEN length(CAST(snapshot AS BLOB)) <= ? THEN snapshot END AS payload FROM workout_transformmate_native WHERE owner_id=? AND account_scope=? AND date BETWEEN ? AND ? ORDER BY date,id',
              [payloadLimit, ownerId, accountScope, from, to],
              offlineLimits.nativeTrainings,
              jsonRow.extend({ date: z.iso.date(), fetchedAt: stamp }),
            ).map((row) => {
              const snapshot = parseJson(
                row.payload,
                transformMateNativeSnapshotSchema,
              );
              if (snapshot.date !== row.date)
                throw new OfflineError(503, 'OFFLINE_UNAVAILABLE');
              return { id: row.id, ...snapshot, fetchedAt: row.fetchedAt };
            });
      return {
        nativeTrainings,
        diary,
        photos,
        measurements,
        weights,
        steps,
        plans,
        sessions,
        transformMateFacts,
      };
    },
    photoCandidates(ownerId: string, date: string) {
      remainingBytes = offlineLimits.payloadBytes;
      return rows(
        'SELECT id,storage_key AS storageKey,mime FROM nutrition_photos WHERE owner_id = ? AND date = ? ORDER BY id',
        [ownerId, date],
        offlineLimits.photos,
        z.object({
          id,
          storageKey: text.regex(/^[a-f0-9]{64}$/),
          mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        }),
      );
    },
  };
}
