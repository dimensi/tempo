import { z } from 'zod';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { nonnegativeDecimalSchema } from '@/contracts/nutrition';

export const healthRangeSchema = analyticsRangeSchema;
export type HealthRange = z.infer<typeof healthRangeSchema>;
export const stepsSummarySchema = z
  .object({
    range: healthRangeSchema,
    days: z
      .array(
        z
          .object({
            date: z.iso.date(),
            steps: z
              .number()
              .int()
              .nonnegative()
              .max(Number.MAX_SAFE_INTEGER)
              .nullable(),
            source: z.literal('YAZIO').nullable(),
          })
          .strict(),
      )
      .max(366),
    observedDays: z.number().int().min(0).max(366),
    totalSteps: nonnegativeDecimalSchema.nullable(),
    averageSteps: nonnegativeDecimalSchema.nullable(),
  })
  .strict();
export type StepsSummary = z.infer<typeof stepsSummarySchema>;
export const weightHistorySchema = z
  .object({
    range: healthRangeSchema,
    local: z.array(
      z
        .object({
          measuredAt: z.iso.date(),
          value: nonnegativeDecimalSchema,
          unit: z.literal('kg'),
          source: z.literal('LOCAL'),
        })
        .strict(),
    ),
    imported: z.array(
      z
        .object({
          measuredAt: z.iso.date(),
          rawValue: nonnegativeDecimalSchema.nullable(),
          unit: z.null(),
          unitStatus: z.literal('UNKNOWN'),
          source: z.literal('YAZIO'),
        })
        .strict(),
    ),
  })
  .strict();
export type WeightHistory = z.infer<typeof weightHistorySchema>;

export function healthRangeDates(input: HealthRange): string[] {
  const { from, to } = healthRangeSchema.parse(input);
  const dates: string[] = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += 86400000)
    dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}
