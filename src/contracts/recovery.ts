import { z } from 'zod';
import { healthRangeSchema } from '@/contracts/health';
import { timezoneSchema } from '@/contracts/nutrition-sync-dates';

export const recoveryRangeSchema = z
  .strictObject({
    from: z.iso.date().refine((date) => date >= '1901-01-01'),
    to: z.iso.date().refine((date) => date <= '9998-12-31'),
    timezone: timezoneSchema.default('UTC'),
  })
  .refine(
    ({ from, to }) => healthRangeSchema.safeParse({ from, to }).success,
    'Use an ordered range of at most 366 days',
  );
export type RecoveryRange = z.infer<typeof recoveryRangeSchema>;

export const recoveryUnits = {
  heart_rate_variability: 'ms',
  resting_heart_rate: 'bpm',
  night_heart_rate: 'bpm',
  respiratory_rate: 'breaths/min',
  apple_sleeping_wrist_temperature: '°C',
  blood_oxygen_saturation: '%',
  breathing_disturbances: 'count',
} as const;
export type RecoveryMetric = keyof typeof recoveryUnits;
export type RecoveryUnit = (typeof recoveryUnits)[RecoveryMetric];
export type RecoverySleepStage = 'core' | 'deep' | 'rem' | 'unspecified';

export type RecoverySleepEpisode = {
  startAt: string;
  endAt: string;
  durationSeconds: number;
  stages: Partial<Record<RecoverySleepStage, number>>;
  awakeSeconds: number | null;
  inBedSeconds: number | null;
  sources: string[];
};

export type RecoveryMetricSummary = {
  value: number;
  unit: RecoveryUnit;
  count: number;
  firstAt: string;
  lastAt: string;
  sources: string[];
};

export type RecoveryDay = {
  date: string;
  sleep: RecoverySleepEpisode[];
  metrics: Partial<Record<RecoveryMetric, RecoveryMetricSummary>>;
};

export type RecoveryHistory = {
  range: RecoveryRange;
  source: 'HEALTH_AUTO_EXPORT';
  days: RecoveryDay[];
  summary: {
    observedDays: number;
    sleep: {
      nights: number;
      episodes: number;
      averageDurationSeconds: number | null;
    };
    metrics: Partial<Record<RecoveryMetric, RecoveryMetricSummary>>;
  };
};
