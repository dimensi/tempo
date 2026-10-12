import { z } from 'zod';
import { nonnegativeDecimalSchema } from '@/contracts/nutrition';

// Wire schemas are projections: SDK declarations do not validate these reads.
export const yazioWeightWireSchema = z
  .object({
    id: z.uuid(),
    date: z.string().min(1).max(128),
    value: z.number().finite().nonnegative().nullable(),
    external_id: z.string().nullable(),
    gateway: z.string().nullable(),
    source: z.string().nullable(),
  })
  .nullable();
export const yazioHealthSummaryWireSchema = z.object({
  steps: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullish(),
  units: z.object({ unit_mass: z.string().max(128).nullish() }).nullish(),
});
export const importedWeightSchema = z
  .object({
    source: z.literal('yazio'),
    externalId: z.uuid(),
    providerDate: z.string().min(1).max(128),
    measuredDate: z.iso.date().nullable(),
    rawValue: nonnegativeDecimalSchema.nullable(),
    unit: z.null(),
    unitContext: z.string().max(128).nullable(),
    upstreamSource: z.string().nullable(),
    gateway: z.string().nullable(),
  })
  .strict();
export const dailyStepsSchema = z
  .object({
    source: z.literal('yazio'),
    date: z.iso.date(),
    steps: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();
export type ImportedWeight = z.infer<typeof importedWeightSchema>;
export type DailySteps = z.infer<typeof dailyStepsSchema>;
