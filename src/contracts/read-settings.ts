import { z } from 'zod';
import { syncStatusSchema, yazioAccountSchema } from './nutrition-sync';
import { nutritionScheduleStatusSchema } from './nutrition-schedule';
import { transformMateConnectionStatusSchema } from './transformmate-connection';
import { dailyGoalsSchema } from './daily-goals';
export const readSettingsSchema = z.strictObject({
  yazio: z.object({
    configured: z.boolean(),
    tokenFileConfigured: z.boolean(),
    sync: syncStatusSchema,
    schedule: nutritionScheduleStatusSchema,
    account: yazioAccountSchema.nullable(),
  }),
  transformMate: transformMateConnectionStatusSchema,
  trainers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      granted: z.boolean(),
    }),
  ),
  goals: dailyGoalsSchema,
});

export type ReadSettings = z.infer<typeof readSettingsSchema>;
