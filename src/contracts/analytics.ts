import { z } from 'zod';
import type { Measurement, MeasurementMetric } from '@/contracts/measurements';
import type { StepsSummary } from '@/contracts/health';
import type { NutritionTotals } from '@/contracts/nutrition';

export const analyticsRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .strict()
  .refine((v) => v.from <= v.to, { message: 'Invalid date order' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 366, {
    message: 'Maximum range is 366 days',
  });
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;
export type Nutrient = keyof NutritionTotals;
export interface NutrientSummary {
  total: string | null;
  mean: string | null;
  confirmedDays: number;
  partialDays: number;
}
export interface AnalyticsSummary {
  range: AnalyticsRange;
  calendarDays: number;
  recordedDays: number;
  nutrients: Record<Nutrient, NutrientSummary>;
  days: Array<{
    date: string;
    totals: NutritionTotals;
    knownTotals: NutritionTotals;
    recorded: boolean;
  }>;
}

export type DayQuality = 'complete' | 'partial' | 'empty' | 'missing';
export interface NutritionAnalysis {
  summary: AnalyticsSummary;
  days: Array<AnalyticsSummary['days'][number] & { quality: DayQuality }>;
  completeDays: number;
  partialDays: number;
  emptyDays: number;
  missingDays: number;
  calorieDays: number;
  calorieMean: string | null;
  macros: {
    days: number;
    averages: Record<'protein' | 'fat' | 'carbs', string | null>;
    energyShares: Record<'protein' | 'fat' | 'carbs', string | null>;
  };
  updatedAt: string | null;
}
export interface AnalyticsChange {
  delta: string;
  percent: string | null;
}
export interface BodyObservation {
  id: string;
  date: string;
  value: string | null;
  source: 'LOCAL' | 'YAZIO';
  rawValue?: string | null;
}
export interface MeasurementAnalysis {
  observations: BodyObservation[];
  first: BodyObservation | null;
  latest: BodyObservation | null;
  delta: string | null;
  weeklyRate: string | null;
  ambiguousEndpoints: boolean;
}
export interface BodyAnalysis {
  metrics: Record<MeasurementMetric, MeasurementAnalysis>;
  measurements: Pick<Measurement, 'id' | 'measuredAt' | 'values'>[];
}
export type AnalyticsBlock<T> =
  | {
      state: 'ready';
      data: T;
      comparison: AnalyticsChange | null;
      comparisonUnavailable: boolean;
    }
  | { state: 'error' };
export interface AnalyticsHighlight {
  kind: 'weight' | 'calories' | 'steps' | 'nutritionQuality' | 'stepsQuality';
  value: string;
}
export interface AnalyticsData {
  goals: import('./daily-goals').DailyGoals[];
  range: AnalyticsRange;
  previousRange: AnalyticsRange;
  today: string;
  timezone: string;
  canSync: boolean;
  nutrition: AnalyticsBlock<NutritionAnalysis>;
  body: AnalyticsBlock<BodyAnalysis>;
  activity: AnalyticsBlock<{ summary: StepsSummary; updatedAt: string | null }>;
  highlights: AnalyticsHighlight[];
}
