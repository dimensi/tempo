import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';

export const nutritionTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');
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
