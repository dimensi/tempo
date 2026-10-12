import { z } from 'zod';
import { transformMateNativeItemSchema } from './transformmate-native';
import {
  ownerConfirmedYazioWeightPolicyVersion,
  ownerConfirmedYazioWeightUnit,
} from './yazio-weight-policy';
import {
  mealKindSchema,
  nutritionTotalsSchema,
  nutritionDeltaSchema,
  nonnegativeDecimalSchema,
} from '@/contracts/nutrition';
import { measurementValueSchema } from '@/contracts/measurements';
import { workoutSetSchema } from '@/contracts/workouts';

export const offlineLimits = {
  days: 30,
  lifetimeMs: 86400000,
  photos: 300,
  measurements: 1000,
  weights: 300,
  plans: 200,
  sessions: 300,
  transformMateFacts: 300,
  nativeTrainings: 300,
  payloadBytes: 4 * 1024 * 1024,
} as const;
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const date = z.iso.date();
const timestamp = z.iso.datetime();
const decimal = nonnegativeDecimalSchema.nullable();
const nativeExercise = transformMateNativeItemSchema.shape.exercises.element;
export const offlineNativeTrainingSchema = transformMateNativeItemSchema
  .omit({ remoteTrainingId: true })
  .extend({
    key: opaque,
    exercises: z
      .array(
        nativeExercise
          .omit({ protocolId: true, remoteExerciseId: true, exerciseId: true })
          .extend({
            metrics: z
              .array(
                nativeExercise.shape.metrics.element
                  .extend({
                    sets: z
                      .array(
                        nativeExercise.shape.metrics.element.shape.sets.element
                          .extend({
                            metrics: z
                              .array(
                                nativeExercise.shape.metrics.element.shape.sets.element.shape.metrics.element
                                  .omit({ key: true })
                                  .strict(),
                              )
                              .max(50),
                          })
                          .strict(),
                      )
                      .max(100),
                  })
                  .strict(),
              )
              .max(10),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const offlinePeriodSchema = z
  .object({ from: date, to: date })
  .strict()
  .refine(({ from, to }) => {
    const difference = (Date.parse(to) - Date.parse(from)) / 86400000;
    return difference >= 0 && difference < offlineLimits.days;
  });
export const offlineIdentitySchema = z
  .object({
    contractVersion: z.literal(1),
    weightPolicyVersion: z.literal(ownerConfirmedYazioWeightPolicyVersion),
    partition: opaque,
    connectionGeneration: opaque,
    role: z.literal('OWNER'),
    serverNow: timestamp,
    sessionExpiresAt: timestamp,
    expiresAt: timestamp,
  })
  .strict();
export type OfflineIdentity = z.infer<typeof offlineIdentitySchema>;
const entry = z
  .object({
    key: opaque,
    kind: z.enum(['product', 'recipe', 'simple', 'ai']),
    name: z.string().max(2000),
    meal: mealKindSchema,
    diaryDateTime: z.string().max(32),
    amount: decimal,
    baseUnit: z.string().max(128).nullable(),
    serving: z.string().max(300).nullable(),
    servingQuantity: decimal,
    consumedPortions: decimal,
    recipePortions: decimal,
    massG: decimal,
    volumeMl: decimal,
    ingredientMassEstimateG: decimal,
    totals: nutritionTotalsSchema,
    issues: z.array(z.string().max(300)).max(50),
  })
  .strict();
const exercise = z
  .object({
    name: z.string().max(160),
    comment: z.string().max(4000).optional(),
    sets: z.array(workoutSetSchema).max(50),
  })
  .strict();
const photo = z
  .object({
    id: opaque,
    date,
    daytime: mealKindSchema,
    source: z.enum(['manual', 'yazio']),
    observedAt: timestamp,
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    downloadUrl: z
      .string()
      .regex(
        /^\/api\/offline\/photos\/[A-Za-z0-9_-]{43}\?date=\d{4}-\d{2}-\d{2}$/,
      ),
  })
  .strict();
const totals = {
  totals: nutritionTotalsSchema,
  knownTotals: nutritionTotalsSchema,
  officialTotals: nutritionTotalsSchema,
  delta: nutritionDeltaSchema,
};
export const offlineSnapshotSchema = offlineIdentitySchema
  .extend({
    from: date,
    to: date,
    diary: z
      .array(
        z
          .object({
            date,
            fetchedAt: timestamp,
            ...totals,
            meals: z
              .array(
                z
                  .object({
                    kind: mealKindSchema,
                    ...totals,
                    entries: z.array(entry).max(1000),
                  })
                  .strict(),
              )
              .length(4),
          })
          .strict(),
      )
      .max(30),
    photos: z
      .object({
        availability: z.literal('metadata-only'),
        items: z.array(photo).max(offlineLimits.photos),
      })
      .strict(),
    measurements: z
      .array(
        z
          .object({
            key: opaque,
            source: z.literal('manual'),
            measuredAt: date,
            values: z.array(measurementValueSchema).min(1).max(7),
            note: z.string().max(2000).nullable(),
          })
          .strict(),
      )
      .max(offlineLimits.measurements),
    importedWeights: z
      .array(
        z
          .object({
            key: opaque,
            source: z.literal('yazio'),
            providerDate: z.string().max(128),
            measuredDate: date,
            rawValue: decimal,
            unit: z.literal(ownerConfirmedYazioWeightUnit.unit),
            unitStatus: z.literal(ownerConfirmedYazioWeightUnit.unitStatus),
            unitContext: z.string().max(128).nullable(),
            observedAt: timestamp,
          })
          .strict(),
      )
      .max(offlineLimits.weights),
    dailySteps: z
      .array(
        z
          .object({
            source: z.literal('yazio'),
            date,
            steps: z
              .number()
              .int()
              .nonnegative()
              .max(Number.MAX_SAFE_INTEGER)
              .nullable(),
            observedAt: timestamp,
          })
          .strict(),
      )
      .max(30),
    plannedWorkouts: z
      .array(
        z
          .object({
            key: opaque,
            date,
            title: z.string().max(160),
            planTitle: z.string().max(160),
            planDescription: z.string().max(4000),
            exercises: z.array(exercise).max(50),
          })
          .strict(),
      )
      .max(1000),
    workoutSessions: z
      .array(
        z
          .object({
            key: opaque,
            date,
            title: z.string().max(160),
            note: z.string().max(4000),
            status: z.enum(['in_progress', 'completed', 'skipped']),
            exercises: z.array(exercise).max(50),
            planTitle: z.string().max(160).nullable(),
          })
          .strict(),
      )
      .max(offlineLimits.sessions),
    nativeTrainings: z
      .array(offlineNativeTrainingSchema)
      .max(offlineLimits.nativeTrainings),
    transformMateFacts: z
      .array(
        z
          .object({
            key: opaque,
            date,
            title: z.string().max(500),
            checkedAt: timestamp.nullable(),
            started: z.string().max(128).nullable(),
            finished: z.string().max(128).nullable(),
            exercises: z
              .array(
                z
                  .object({
                    name: z.string().max(500),
                    comment: z.string().max(4000),
                    sets: z
                      .array(
                        z
                          .object({
                            order: z.number().int().positive(),
                            done: z.boolean(),
                            metrics: z
                              .array(
                                z
                                  .object({
                                    name: z.string().max(500),
                                    unit: z.string().max(100),
                                    type: z.string().max(100),
                                    values: z
                                      .array(z.string().max(1000))
                                      .max(100),
                                  })
                                  .strict(),
                              )
                              .max(50),
                          })
                          .strict(),
                      )
                      .max(100),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(offlineLimits.transformMateFacts),
  })
  .strict();
export type OfflineSnapshot = z.infer<typeof offlineSnapshotSchema>;
export const offlineErrorSchema = z
  .object({
    error: z.enum([
      'OFFLINE_ACCESS_DENIED',
      'OFFLINE_INVALID_REQUEST',
      'OFFLINE_LIMIT_EXCEEDED',
      'OFFLINE_CONNECTION_CHANGED',
      'OFFLINE_UNAVAILABLE',
    ]),
  })
  .strict();
