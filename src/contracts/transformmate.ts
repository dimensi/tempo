import { z } from 'zod';
import { plannedWorkoutSchema } from '@/contracts/workouts';
import type {
  TransformMateNativePage,
  TransformMateNativeRefresh,
} from '@/contracts/transformmate-native';

const remoteId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const transformMateCoverageSchema = z.enum([
  'unknown',
  'available',
  'absent',
]);
const catalogName = z.string().min(1).max(500);
const filterName = catalogName.refine((name) => !name.includes(','));
export const transformMateMuscleGroupInfoSchema = z.object({
  id: remoteId,
  name: catalogName,
  commonGroup: z.object({ id: remoteId, name: catalogName }),
  muscleIds: z.array(remoteId).max(1000),
});
export type TransformMateMuscleGroupInfo = z.infer<
  typeof transformMateMuscleGroupInfoSchema
>;
export const transformMateCatalogFiltersSchema = z.strictObject({
  query: z.string().max(200),
  commonMuscleGroup: filterName.nullable(),
  muscleGroups: z.array(filterName).max(50),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(50),
});
export type TransformMateCatalogFilters = z.infer<
  typeof transformMateCatalogFiltersSchema
>;
export const transformMateCatalogMetadataSchema = z.object({
  fetchedAt: z.iso.datetime().nullable(),
  stale: z.boolean(),
  coverage: z.enum(['unknown', 'partial', 'complete']),
  refreshState: z.enum(['idle', 'updating', 'unavailable']),
  total: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
  unknownMembershipCount: z.number().int().nonnegative(),
  filters: transformMateCatalogFiltersSchema,
});
export type TransformMateCatalogMetadata = z.infer<
  typeof transformMateCatalogMetadataSchema
>;
export const transformMatePublicationCapabilitySchema = z.discriminatedUnion(
  'state',
  [
    z.object({ state: z.literal('unknown'), reason: z.null() }),
    z.object({ state: z.literal('supported'), reason: z.null() }),
    z.object({
      state: z.literal('unsupported'),
      reason: z.enum(['metric_count', 'weight_metric', 'reps_metric']),
    }),
  ],
);
const privatePreviewPath = z
  .string()
  .max(1000)
  .refine((value) => {
    const match = value.match(
      /^\/api\/workouts\/transformmate\/exercises\/([1-9][0-9]*)\/preview\?ownerId=([^&?#]+)$/,
    );
    return Boolean(
      match &&
      Number.isSafeInteger(Number(match[1])) &&
      (() => {
        try {
          const owner = decodeURIComponent(match[2]!);
          return owner.length > 0 && encodeURIComponent(owner) === match[2];
        } catch {
          return false;
        }
      })(),
    );
  });
const catalogRichFields = {
  publicationCapability: transformMatePublicationCapabilitySchema,
  snippet: z.string().max(500).nullable(),
  preview: z.discriminatedUnion('coverage', [
    z.object({
      coverage: z.literal('unknown'),
      path: z.null(),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    z.object({
      coverage: z.literal('absent'),
      path: z.null(),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    z.object({
      coverage: z.literal('available'),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      // A private app route only; upstream URLs never enter the browser DTO.
      path: privatePreviewPath,
    }),
  ]),
  detailCoverage: transformMateCoverageSchema,
  membershipCoverage: transformMateCoverageSchema,
  muscleGroups: z.array(z.object({ id: remoteId, name: catalogName })).max(100),
  fetchedAt: z.iso.datetime(),
  detailFetchedAt: z.iso.datetime().nullable(),
};
export const transformMateCatalogItemSchema = z.object({
  id: remoteId,
  name: z.string().max(500),
  canPlan: z.boolean(),
  ...catalogRichFields,
});
export type TransformMateCatalogItem = z.infer<
  typeof transformMateCatalogItemSchema
>;
export const transformMateExerciseInfoSchema = z.object({
  id: remoteId,
  name: z.string().max(500),
  description: z.string().max(20000),
  canPlan: z.boolean(),
  hasVideo: z.boolean(),
  ...catalogRichFields,
  muscles: z
    .array(
      z.object({
        id: remoteId,
        name: catalogName,
        group: z.object({ id: remoteId, name: catalogName }),
        isMain: z.boolean().nullable(),
      }),
    )
    .max(1000),
  stale: z.boolean(),
});
export type TransformMateExerciseInfo = z.infer<
  typeof transformMateExerciseInfoSchema
>;
export const transformMateCatalogResultSchema = z.object({
  contractVersion: z.literal(1),
  source: z.literal('user'),
  data: z.array(transformMateCatalogItemSchema).max(50),
  catalog: transformMateCatalogMetadataSchema,
});
export type TransformMateCatalogResult = z.infer<
  typeof transformMateCatalogResultSchema
>;
export const transformMateMuscleDictionarySchema = z.object({
  groups: z.array(transformMateMuscleGroupInfoSchema).max(1000),
  fetchedAt: z.iso.datetime().nullable(),
  stale: z.boolean(),
  coverage: z.enum(['unknown', 'complete']),
});
export type TransformMateMuscleDictionary = z.infer<
  typeof transformMateMuscleDictionarySchema
>;
export const transformMateActualSchema = z.object({
  date: z.iso.date(),
  title: z.string().max(500),
  started: z.string().nullable(),
  finished: z.string().nullable(),
  exercises: z
    .array(
      z.object({
        occurrenceKey: z.string().nullable(),
        exerciseId: remoteId,
        name: z.string().max(500),
        comment: z.string().max(4000),
        sets: z
          .array(
            z.object({
              order: z.number().int().positive(),
              done: z.boolean(),
              // Preserve unsupported/empty/range metrics without inventing numeric results.
              metrics: z
                .array(
                  z.object({
                    name: z.string().max(500),
                    unit: z.string().max(100),
                    type: z.string().max(100),
                    values: z.array(z.string().max(1000)).max(100),
                  }),
                )
                .max(50),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});
export type TransformMateActual = z.infer<typeof transformMateActualSchema>;
export const transformMateSyncStatusSchema = z.enum([
  'pending',
  'synced',
  'unavailable',
  'error',
  'conflict',
  'started',
  'unknown',
]);
export const transformMateSyncItemSchema = z.object({
  id: z.uuid(),
  planId: z.string(),
  workoutId: z.string(),
  remoteTrainingId: remoteId.nullable(),
  planSnapshot: z.object({
    planTitle: z.string().max(160),
    workout: plannedWorkoutSchema,
  }),
  publishedSnapshot: z
    .object({
      planTitle: z.string().max(160),
      workout: plannedWorkoutSchema,
    })
    .optional(),
  updateAttempt: z
    .object({
      id: z.uuid(),
      phase: z.enum(['pending', 'unknown', 'verified', 'conflict']),
      createdAt: z.iso.datetime(),
      checkedAt: z.iso.datetime().nullable(),
    })
    .optional(),
  status: transformMateSyncStatusSchema,
  reason: z
    .enum([
      'not_configured',
      'unsupported',
      'remote_changed',
      'plan_changed',
      'remote_started',
      'remote_fact',
      'ambiguous_write',
      'upstream_error',
      'missing_remote',
    ])
    .nullable(),
  checkedAt: z.iso.datetime().nullable(),
  actual: transformMateActualSchema.nullable(),
});
export type TransformMateSyncItem = z.infer<typeof transformMateSyncItemSchema>;
export interface TransformMateSyncData {
  configured: boolean;
  items: TransformMateSyncItem[];
  nativePage: TransformMateNativePage;
  nativeRefresh: TransformMateNativeRefresh;
}
