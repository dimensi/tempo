import { z } from 'zod';
import { dailyGoalsSchema } from './daily-goals';
import { analyticsRangeSchema, type AnalyticsData } from './analytics';
import { measurementSchema, measurementMetrics } from './measurements';
import { stepsSummarySchema } from './health';
import { nutritionTotalsSchema } from './nutrition';
// Explicit presentation whitelist for local reads; no upstream payloads or credentials.
const decimal = z.string().nullable();
const nutrients = z.object({
  calories: decimal,
  protein: decimal,
  fat: decimal,
  carbs: decimal,
});
const nutrient = z.object({
  total: decimal,
  mean: decimal,
  confirmedDays: z.number(),
  partialDays: z.number(),
});
const day = z.object({
  date: z.iso.date(),
  totals: nutritionTotalsSchema,
  knownTotals: nutritionTotalsSchema,
  recorded: z.boolean(),
});
const observation = z.object({
  id: z.string(),
  date: z.string(),
  value: decimal,
  source: z.enum(['LOCAL', 'YAZIO']),
  rawValue: decimal.optional(),
});
const metric = z.object({
  observations: z.array(observation),
  first: observation.nullable(),
  latest: observation.nullable(),
  delta: decimal,
  weeklyRate: decimal,
  ambiguousEndpoints: z.boolean(),
});
const change = z.object({ delta: z.string(), percent: decimal }).nullable();
const block = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('state', [
    z.object({
      state: z.literal('ready'),
      data,
      comparison: change,
      comparisonUnavailable: z.boolean(),
    }),
    z.object({ state: z.literal('error') }),
  ]);
export const analyticsDataSchema: z.ZodType<AnalyticsData> = z.object({
  goals: z.array(dailyGoalsSchema),
  range: analyticsRangeSchema,
  previousRange: analyticsRangeSchema,
  today: z.iso.date(),
  timezone: z.string(),
  canSync: z.boolean(),
  nutrition: block(
    z.object({
      summary: z.object({
        range: analyticsRangeSchema,
        calendarDays: z.number(),
        recordedDays: z.number(),
        nutrients: z.object({
          calories: nutrient,
          protein: nutrient,
          fat: nutrient,
          carbs: nutrient,
        }),
        days: z.array(day),
      }),
      days: z.array(
        day.extend({
          quality: z.enum(['complete', 'partial', 'empty', 'missing']),
        }),
      ),
      completeDays: z.number(),
      partialDays: z.number(),
      emptyDays: z.number(),
      missingDays: z.number(),
      calorieDays: z.number(),
      calorieMean: decimal,
      macros: z.object({
        days: z.number(),
        averages: nutrients.omit({ calories: true }),
        energyShares: nutrients.omit({ calories: true }),
      }),
      updatedAt: decimal,
    }),
  ),
  body: block(
    z.object({
      metrics: z.record(z.enum(measurementMetrics), metric),
      measurements: z.array(
        z.object({
          id: measurementSchema.shape.id,
          measuredAt: measurementSchema.shape.measuredAt,
          values: measurementSchema.shape.values,
        }),
      ),
    }),
  ),
  activity: block(
    z.object({ summary: stepsSummarySchema, updatedAt: decimal }),
  ),
  highlights: z.array(
    z.object({
      kind: z.enum([
        'weight',
        'calories',
        'steps',
        'nutritionQuality',
        'stepsQuality',
      ]),
      value: z.string(),
    }),
  ),
});
