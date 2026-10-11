import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';

import { timezoneSchema } from '@/contracts/nutrition-sync-dates';

export const nutritionTimezoneSchema = timezoneSchema;
export const nutritionScheduleInputSchema = z
  .object({
    timezone: nutritionTimezoneSchema,
    initialFrom: diaryDateSchema,
  })
  .strict();
export type NutritionScheduleInput = z.infer<
  typeof nutritionScheduleInputSchema
>;
export const nutritionScheduleStatusSchema = z.object({
  enabled: z.boolean(),
  schedulerActive: z.boolean(),
  timezone: nutritionTimezoneSchema,
  initialFrom: diaryDateSchema.nullable(),
  lastSuccess: z.iso.datetime().nullable(),
  lastError: z.enum(['NOT_CONFIGURED', 'SYNC_FAILED', 'LEASE_LOST']).nullable(),
  nextRunAt: z.iso.datetime().nullable(),
  attempt: z.number().int().min(0).max(3),
  running: z.boolean(),
});
export type NutritionScheduleStatus = z.infer<
  typeof nutritionScheduleStatusSchema
>;
