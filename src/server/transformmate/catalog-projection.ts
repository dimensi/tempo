import 'server-only';
import { createHash } from 'node:crypto';
import type { CatalogIdentity } from '@/server/transformmate/catalog-store';
import { transformMatePublicationCapability } from '@/contracts/transformmate-capability';
import { z } from 'zod';
import { replicaStore } from './replica-store';
import {
  transformMateCatalogSchema,
  canPlanExercise,
} from '@/server/transformmate/catalog-schema';
import type { TransformMateExerciseDetail } from '@/server/transformmate/types';
import {
  transformMateCatalogItemSchema,
  transformMateExerciseInfoSchema,
} from '@/contracts/transformmate';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const named = z.object({ id, name: z.string().max(500) });
export const persistedDetailSchema = z.object({
  id,
  name: z.string().max(500),
  description: z.string().max(20000),
  other_names: z.array(z.string().max(500)).max(50),
  image: z.string().max(4000).nullable(),
  previewCoverage: z.enum(['unknown', 'available', 'absent']),
  previewCheckedAt: z.iso.datetime().nullable(),
  muscles: z
    .array(
      z.object({
        muscle: named.extend({ muscle_group: named }),
        position: z.object({ is_main: z.boolean() }).nullable(),
      }),
    )
    .max(1000),
  metrics: z
    .array(
      z.object({
        id,
        key: z.string().max(100),
        set_metric_types: z
          .array(z.object({ type: z.string().max(100) }))
          .max(50),
      }),
    )
    .max(50),
  videoMetadataComplete: z.boolean(),
  kinescope_data: z
    .array(
      z.object({
        id: z.string().nullable(),
        resolution: z.string().nullable(),
        file_size: z.number().int().nonnegative().optional(),
        created_at: z.iso.datetime({ offset: true }).optional(),
        url: z.string().max(4000).nullable(),
        filetype: z.string().max(100).optional(),
      }),
    )
    .max(50)
    .nullable(),
});
export type PersistedDetail = z.infer<typeof persistedDetailSchema>;
export type Summary = z.infer<typeof transformMateCatalogSchema>[number];
export function projectDetail(
  detail: TransformMateExerciseDetail,
): PersistedDetail {
  return persistedDetailSchema.parse({
    ...detail,
    videoMetadataComplete: true,
    previewCoverage: detail.image === null ? 'absent' : 'unknown',
    previewCheckedAt: null,
    other_names: detail.other_names
      .slice(0, 50)
      .map((name) => name.slice(0, 500)),
  });
}
export function publicationCapability(
  detail: Pick<PersistedDetail, 'metrics'> | null,
) {
  return transformMatePublicationCapability(detail?.metrics ?? null);
}
export function catalogItem(
  summary: Summary,
  fetchedAt: string,
  detail: PersistedDetail | null,
  detailFetchedAt: string | null,
  identity: CatalogIdentity,
) {
  const ownerId = identity.ownerId;
  const replica = replicaStore().job(identity, `exercise:${summary.id}`)?.data;
  const localPreview = Boolean(replica?.poster || replica?.image);
  const available = localPreview || detail?.previewCoverage === 'available';
  const groups = new Map(
    detail?.muscles.map(({ muscle }) => [
      muscle.muscle_group.id,
      muscle.muscle_group,
    ]),
  );
  return transformMateCatalogItemSchema.parse({
    id: summary.id,
    name: detail?.name ?? summary.name,
    canPlan: canPlanExercise(summary),
    publicationCapability: publicationCapability(detail),
    snippet: detail ? detail.description.slice(0, 500) : null,
    // A non-null unvalidated URL is unknown, never an invented/unsafe preview.
    preview: {
      revision: createHash('sha256')
        .update(
          JSON.stringify([
            identity.ownerId,
            identity.accountScope,
            identity.locale,
            summary.id,
            detail?.image,
            replica?.poster?.key ?? replica?.image?.key,
          ]),
        )
        .digest('hex'),
      coverage:
        available && ownerId
          ? 'available'
          : detail?.image === null
            ? 'absent'
            : 'unknown',
      path:
        available && ownerId
          ? `/api/workouts/transformmate/exercises/${summary.id}/preview?ownerId=${encodeURIComponent(ownerId)}`
          : null,
    },
    detailCoverage: detail ? 'available' : 'unknown',
    membershipCoverage: detail
      ? groups.size
        ? 'available'
        : 'absent'
      : 'unknown',
    muscleGroups: [...groups.values()],
    fetchedAt,
    detailFetchedAt,
  });
}
export function detailInfo(
  summary: Summary,
  fetchedAt: string,
  detail: PersistedDetail,
  detailFetchedAt: string,
  stale: boolean,
  hasVideo: boolean,
  identity: CatalogIdentity,
) {
  return transformMateExerciseInfoSchema.parse({
    ...catalogItem(summary, fetchedAt, detail, detailFetchedAt, identity),
    description: detail.description,
    hasVideo,
    muscles: detail.muscles.map(({ muscle, position }) => ({
      id: muscle.id,
      name: muscle.name,
      group: muscle.muscle_group,
      isMain: position?.is_main ?? null,
    })),
    stale,
  });
}
