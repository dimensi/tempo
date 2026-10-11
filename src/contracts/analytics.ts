import { z } from 'zod';
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
