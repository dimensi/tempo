import { z } from 'zod';

export const healthAutoExportMetrics = [
  'sleep_analysis',
  'heart_rate_variability',
  'resting_heart_rate',
  'heart_rate',
  'respiratory_rate',
  'apple_sleeping_wrist_temperature',
  'blood_oxygen_saturation',
  'breathing_disturbances',
] as const;
export type HealthAutoExportMetric = (typeof healthAutoExportMetrics)[number];

export const healthAutoExportSleepStages = [
  'asleep',
  'core',
  'deep',
  'rem',
  'awake',
  'in_bed',
  'unspecified',
] as const;
export type HealthAutoExportSleepStage =
  (typeof healthAutoExportSleepStages)[number];

export type HealthAutoExportSample = {
  metric: HealthAutoExportMetric;
  source: string | null;
  startAt: string;
  endAt: string;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
  startDate: string;
  endDate: string;
  stage: HealthAutoExportSleepStage | null;
  value: number | null;
  unit: 'seconds' | 'ms' | 'bpm' | 'breaths/min' | '°C' | '%' | 'count';
  min: number | null;
  max: number | null;
};

export const healthAutoExportErrorCodes = [
  'invalid_payload',
  'json_required',
  'payload_too_large',
  'body_timeout',
  'import_unavailable',
] as const;
export type HealthAutoExportErrorCode =
  (typeof healthAutoExportErrorCodes)[number];

export const healthAutoExportStatusSchema = z
  .object({
    connected: z.boolean(),
    endpoint: z.url().nullable(),
    lastAttemptAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    lastInserted: z.number().int().nonnegative().nullable(),
    lastErrorAt: z.iso.datetime().nullable(),
    lastErrorCode: z.enum(healthAutoExportErrorCodes).nullable(),
  })
  .strict();
export type HealthAutoExportStatus = z.infer<
  typeof healthAutoExportStatusSchema
>;

export const healthAutoExportTokenSchema = z
  .object({
    token: z.string().regex(/^hae_[A-Za-z0-9_-]{43}$/),
    status: healthAutoExportStatusSchema,
  })
  .strict();
export type HealthAutoExportToken = z.infer<typeof healthAutoExportTokenSchema>;
