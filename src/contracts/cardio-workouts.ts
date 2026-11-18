import { z } from 'zod';
import { revisionSchema } from './workouts';

const distanceMeters = z.number().nonnegative().max(1_000_000);
const energyKcal = z.number().nonnegative().max(100_000);
const durationSeconds = z.number().positive().max(604_800);
const time = z.iso.time({ precision: -1 });
const equipment = z.string().trim().max(120).nullable();
const note = z.string().trim().max(4000);
export const cardioInputSchema = z.strictObject({
  date: z.iso.date(),
  type: z.string().trim().min(1).max(100),
  time: time.nullable().default(null),
  durationSeconds,
  distanceMeters: distanceMeters.nullable().default(null),
  energyKcal: energyKcal.nullable().default(null),
  equipment: equipment.default(null),
  note: note.default(''),
});
export const cardioOverridesSchema = z.strictObject({
  distanceMeters: distanceMeters.nullable().optional(),
  equipment: equipment.optional(),
  note: note.optional(),
});
export const importedExerciseSchema = z.strictObject({
  bucket: z.enum(['training', 'custom_training']),
  providerId: z.string().min(1).max(190),
  providerDate: z.string().min(1).max(80),
  gateway: z.string().max(128).nullable(),
  providerSource: z.string().max(128).nullable(),
  externalId: z.string().max(200).nullable(),
  date: z.iso.date(),
  time: time.nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  type: z.string().min(1).max(160),
  durationSeconds: z.number().nonnegative().max(604_800).nullable(),
  distanceMeters: distanceMeters.nullable(),
  energyKcal: energyKcal.nullable(),
  note,
  strength: z.boolean(),
});
export const cardioLinkSchema = z.strictObject({
  kind: z.enum(['cardio', 'strength']),
  id: z.string().min(1).max(200),
});
export const cardioWorkoutSchema = z.strictObject({
  id: z.string().min(1).max(200),
  revision: revisionSchema,
  manual: cardioInputSchema.nullable(),
  imported: importedExerciseSchema.nullable(),
  overrides: cardioOverridesSchema,
  link: cardioLinkSchema.nullable(),
});
export const cardioCoverageSchema = z.strictObject({
  date: z.iso.date(),
  fetchedAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
});
export const cardioDaySchema = z.strictObject({
  workouts: z.array(cardioWorkoutSchema),
  coverage: cardioCoverageSchema,
});
const key = { requestId: z.uuid() };
const update = { id: z.string().min(1).max(200), revision: revisionSchema };
export const createCardioInputSchema = z.strictObject({
  ...key,
  data: cardioInputSchema,
});
export const updateCardioInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...key,
    ...update,
    kind: z.literal('manual'),
    data: cardioInputSchema,
  }),
  z.strictObject({
    ...key,
    ...update,
    kind: z.literal('imported'),
    overrides: cardioOverridesSchema,
  }),
  z.strictObject({
    ...key,
    ...update,
    kind: z.literal('link'),
    target: cardioLinkSchema.nullable(),
  }),
]);
export const cardioCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), input: createCardioInputSchema }),
  z.strictObject({ kind: z.literal('update'), input: updateCardioInputSchema }),
]);
export type CardioInput = z.infer<typeof cardioInputSchema>;
export type CardioOverrides = z.infer<typeof cardioOverridesSchema>;
export type ImportedExercise = z.infer<typeof importedExerciseSchema>;
export type CardioWorkout = z.infer<typeof cardioWorkoutSchema>;
export type CardioCommand = z.infer<typeof cardioCommandSchema>;
export type CardioDay = z.infer<typeof cardioDaySchema>;
