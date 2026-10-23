import { z } from 'zod';

export const savedSourceFreshnessSchema = z.strictObject({
  source: z.enum(['LOCAL', 'YAZIO', 'TransformMate']),
  state: z.enum(['ready', 'unavailable']),
  latestRecordDate: z.iso.date().nullable(),
  lastFetchedAt: z.iso.datetime({ offset: true }).nullable(),
  lastCheckedAt: z.iso.datetime({ offset: true }).nullable(),
  syncState: z.enum([
    'unknown',
    'not_applicable',
    'running',
    'completed',
    'partial',
    'failed',
  ]),
  lastRun: z
    .strictObject({
      startedAt: z.iso.datetime({ offset: true }).nullable(),
      finishedAt: z.iso.datetime({ offset: true }).nullable(),
      failedDates: z.array(z.iso.date()),
    })
    .optional(),
  automatic: z
    .strictObject({
      enabled: z.boolean(),
      active: z.boolean(),
      lastSuccessAt: z.iso.datetime().nullable(),
      lastErrorCode: z
        .enum(['NOT_CONFIGURED', 'SYNC_FAILED', 'LEASE_LOST'])
        .nullable(),
      nextRunAt: z.iso.datetime().nullable(),
    })
    .optional(),
});
export type SavedSourceFreshness = z.infer<typeof savedSourceFreshnessSchema>;

export const savedWorkoutFreshnessSchema = z.strictObject({
  transformmateLinked: savedSourceFreshnessSchema,
  transformmateNative: savedSourceFreshnessSchema,
});
