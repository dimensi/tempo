import 'server-only';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { yazioObservationDate } from '@/lib/yazio-observations';
import { z } from 'zod';
import { syncProgress } from '@/server/yazio/sync-progress';
import { getDatabase } from '@/server/db';
import {
  yazioDailySteps,
  yazioWeightEntries,
} from '@/server/db/schema/yazio-health';
import {
  dailyStepsSchema,
  importedWeightSchema,
  type DailySteps,
  type ImportedWeight,
} from '@/contracts/yazio-health';

const ownerSchema = z.string().min(1).max(128);
const weightStorageSchema = importedWeightSchema.extend({
  upstreamSource: z.string().max(128).nullable(),
  gateway: z.string().max(128).nullable(),
});
const periodSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    return days >= 0 && days <= 365;
  });
const observedAtSchema = z.iso.datetime();

// Internal persistence only. Consumers authorize owner scope and fence the lease
// immediately before each synchronous read/write; no upstream awaits occur here.
export function yazioHealthRepository(db = getDatabase().db) {
  return {
    upsert(
      ownerId: string,
      batch: { weights: ImportedWeight[]; dailySteps: DailySteps[] },
      observedAt: string,
      completed?: { steps: string[]; weight: string[] },
    ) {
      const owner = ownerSchema.parse(ownerId);
      const observed = observedAtSchema.parse(observedAt);
      const weights = z
        .array(weightStorageSchema)
        .max(366)
        .parse(batch.weights);
      const dailySteps = z
        .array(dailyStepsSchema)
        .max(366)
        .parse(batch.dailySteps);
      db.transaction((tx) => {
        for (const record of weights) {
          const values = {
            externalId: record.externalId.toLowerCase(),
            providerDate: record.providerDate,
            measuredDate: record.measuredDate,
            rawValue: record.rawValue,
            unit: record.unit,
            unitContext: record.unitContext,
            upstreamSource: record.upstreamSource,
            gateway: record.gateway,
            ownerId: owner,
            observedAt: observed,
          };
          tx.insert(yazioWeightEntries)
            .values(values)
            .onConflictDoUpdate({
              target: [
                yazioWeightEntries.ownerId,
                yazioWeightEntries.externalId,
              ],
              set: values,
            })
            .run();
        }
        for (const record of dailySteps) {
          const values = {
            ownerId: owner,
            date: record.date,
            steps: record.steps,
            observedAt: observed,
          };
          tx.insert(yazioDailySteps)
            .values(values)
            .onConflictDoUpdate({
              target: [yazioDailySteps.ownerId, yazioDailySteps.date],
              set: values,
            })
            .run();
        }
        // Use the same Drizzle connection/transaction as the imported observations.
        if (completed) {
          const progress = syncProgress({ db });
          for (const date of completed.steps)
            progress.set(owner, date, { steps: true });
          for (const date of completed.weight)
            progress.set(owner, date, { weight: true });
        }
      });
    },
    weights(ownerId: string, period: { from: string; to: string }) {
      const owner = ownerSchema.parse(ownerId);
      const { from, to } = periodSchema.parse(period);
      const date = sql<string>`coalesce(${yazioWeightEntries.measuredDate}, substr(${yazioWeightEntries.providerDate}, 1, 10))`;
      return db
        .select()
        .from(yazioWeightEntries)
        .where(
          and(
            eq(yazioWeightEntries.ownerId, owner),
            gte(date, from),
            lte(date, to),
          ),
        )
        .orderBy(asc(date), asc(yazioWeightEntries.externalId))
        .all()
        .flatMap((record) => {
          const measuredDate = yazioObservationDate(
            record.measuredDate ?? record.providerDate,
          );
          return measuredDate ? [{ ...record, measuredDate }] : [];
        });
    },
    steps(ownerId: string, period: { from: string; to: string }) {
      const owner = ownerSchema.parse(ownerId);
      const { from, to } = periodSchema.parse(period);
      return db
        .select()
        .from(yazioDailySteps)
        .where(
          and(
            eq(yazioDailySteps.ownerId, owner),
            gte(yazioDailySteps.date, from),
            lte(yazioDailySteps.date, to),
          ),
        )
        .orderBy(asc(yazioDailySteps.date))
        .all();
    },
  };
}
