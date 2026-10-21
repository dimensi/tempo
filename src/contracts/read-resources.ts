import { z } from 'zod';
import {
  anamnesisMarkerSummarySchema,
  anamnesisOverviewSchema,
  medicalDocumentSchema,
  medicalImportJobSchema,
  medicalMarkerSchema,
  medicalObservationSchema,
  medicalObservationSourceSchema,
  medicalReportExportSchema,
} from './anamnesis';
import { stepsSummarySchema, weightHistorySchema } from './health';
import { measurementSchema } from './measurements';
import {
  nutritionDaySchema,
  nutritionTotalsSchema,
  safeMealPhotoViewSchema,
} from './nutrition';
import type { OverviewData } from './overview';
import { analyticsDataSchema } from './read-analytics';
import { readContextSchema } from './read-context';
import { readSettingsSchema } from './read-settings';
import { workoutDetailSchema } from './read-workout';
import { stepsGoalSchema } from './steps-goal';
import {
  transformMateCatalogResultSchema,
  transformMateExerciseInfoSchema,
  transformMateMuscleDictionarySchema,
  transformMateSyncItemSchema,
} from './transformmate';
import {
  transformMateNativePageSchema,
  transformMateNativeRefreshSchema,
} from './transformmate-native';
import { workoutPlanSchema, workoutSessionSchema } from './workouts';
const weightPoint = z.object({
  date: z.string(),
  value: z.string().nullable(),
});
const workout = z.object({ title: z.string(), date: z.string() }).nullable();
export const workoutsReadSchema = z.object({
  data: z.object({
    plans: z.array(workoutPlanSchema),
    sessions: z.array(workoutSessionSchema),
  }),
});
export const overviewReadSchema: z.ZodType<OverviewData> = z.object({
  today: z.string(),
  timezone: z.string(),
  nutrition: z.object({
    today: nutritionTotalsSchema.nullable(),
    meanCalories: z.string().nullable(),
    recordedDays: z.number(),
    confirmedDays: z.number(),
    partialDays: z.number(),
  }),
  weight: z.object({
    latest: z.object({ date: z.string(), value: z.string() }).nullable(),
    points: z.array(weightPoint),
  }),
  workouts: z.object({ planned: workout, completed: workout }),
  sync: z
    .object({
      running: z.boolean(),
      lastSuccess: z.string().nullable(),
      hasError: z.boolean(),
    })
    .optional(),
});
export const transformMateReadSchema = z.object({
  data: z.object({
    configured: z.boolean(),
    items: z.array(transformMateSyncItemSchema),
    nativePage: transformMateNativePageSchema,
    nativeRefresh: transformMateNativeRefreshSchema,
  }),
});
export const documentObservationsReadSchema = z.array(
  z.object({
    observation: medicalObservationSchema,
    sources: z.array(medicalObservationSourceSchema),
  }),
);
export const commentsReadSchema = z.array(
  z.object({
    id: z.string(),
    authorId: z.string().nullable(),
    authorName: z.string(),
    body: z.string().max(4000),
    parentId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    canEdit: z.boolean(),
  }),
);
export const exerciseReadSchema = z.object({
  data: transformMateExerciseInfoSchema,
});
export const muscleDictionaryReadSchema = z.object({
  data: transformMateMuscleDictionarySchema,
});
/** Only these explicit view contracts may reach disk. Never settings credentials, jobs or upstream payloads. */
export function readResponseSchema(path: string): z.ZodType | undefined {
  if (path === '/api/read/settings') return readSettingsSchema;
  if (path === '/api/read/analytics') return analyticsDataSchema;
  if (path === '/api/workouts/transformmate/exercises')
    return transformMateCatalogResultSchema;
  if (/^\/api\/workouts\/transformmate\/exercises\/[1-9][0-9]*$/.test(path))
    return exerciseReadSchema;
  if (path === '/api/workouts/transformmate/muscle-groups')
    return muscleDictionaryReadSchema;
  if (path === '/api/workouts/transformmate') return transformMateReadSchema;
  if (path === '/api/read/context') return readContextSchema;
  if (path === '/api/read/workout') return workoutDetailSchema;
  if (path === '/api/nutrition/photos') return z.array(safeMealPhotoViewSchema);
  if (path === '/api/comments') return commentsReadSchema;
  if (path === '/api/overview') return overviewReadSchema;
  if (path === '/api/measurements') return z.array(measurementSchema);
  if (path === '/api/health/weight') return weightHistorySchema;
  if (path === '/api/health/steps') return stepsSummarySchema;
  if (path === '/api/settings/steps-goal') return stepsGoalSchema;
  if (path === '/api/nutrition/days') return z.array(nutritionDaySchema);
  if (/^\/api\/nutrition\/days\/\d{4}-\d{2}-\d{2}$/.test(path))
    return nutritionDaySchema;
  if (path === '/api/workouts') return workoutsReadSchema;
  if (path === '/api/anamnesis/overview') return anamnesisOverviewSchema;
  if (path === '/api/anamnesis/markers')
    return z.array(anamnesisMarkerSummarySchema);
  if (path === '/api/anamnesis/imports') return z.array(medicalImportJobSchema);
  if (path === '/api/anamnesis/documents')
    return z.array(medicalDocumentSchema);
  if (path === '/api/anamnesis/reports')
    return z.array(medicalReportExportSchema);
  if (/^\/api\/anamnesis\/markers\/[^/]+$/.test(path))
    return medicalMarkerSchema;
  if (/^\/api\/anamnesis\/markers\/[^/]+\/observations$/.test(path))
    return z.array(medicalObservationSchema);
  if (/^\/api\/anamnesis\/documents\/[^/]+$/.test(path))
    return medicalDocumentSchema;
  if (/^\/api\/anamnesis\/documents\/[^/]+\/observations$/.test(path))
    return documentObservationsReadSchema;
}
export const readRecordSchema = z
  .object({
    version: z.literal(2),
    coverage: z.enum(['complete', 'partial']),
    key: z.string().max(2000),
    savedAt: z.number().finite(),
    touchedAt: z.number().finite(),
    body: z.string().max(10 * 1024 * 1024),
  })
  .strict();
export type ReadRecord = z.infer<typeof readRecordSchema>;
export function isMedicalDetail(key: string) {
  const path = new URL(key, 'https://tempo.local').pathname;
  return /^\/api\/anamnesis\/(?:markers|documents)\/[^/]+/.test(path);
}
export function pruneReadRecords(records: ReadRecord[], now: number) {
  const ttl = 15 * 86400000;
  const rows = records
    .filter(
      (row) =>
        row.version === 2 && now >= row.savedAt && now - row.touchedAt < ttl,
    )
    .sort(
      (a, b) =>
        Number(b.key === '/api/read/context') -
          Number(a.key === '/api/read/context') || b.touchedAt - a.touchedAt,
    );
  let details = 0,
    detailBytes = 0,
    otherBytes = 0;
  return rows.filter((row) => {
    const size = new TextEncoder().encode(row.body).length;
    if (isMedicalDetail(row.key)) {
      details++;
      detailBytes += size;
      return details <= 100 && detailBytes <= 10 * 1024 * 1024;
    }
    otherBytes += size;
    return otherBytes <= 4 * 1024 * 1024;
  });
}

/** Redact safe settings projection; cache only the resource actually returned. */
export function offlineReadBody(key: string, body: string): string | undefined {
  if (new URL(key, 'https://tempo.local').pathname === '/api/read/settings') {
    const data = readSettingsSchema.parse(JSON.parse(body));
    if (data.yazio.account) data.yazio.account.avatar = null;
    return JSON.stringify(data);
  }
  return body;
}

export function isCacheableReadUrl(url: URL) {
  if (!readResponseSchema(url.pathname)) return false;
  const allowed = [
    'ownerId',
    'from',
    'to',
    'timezone',
    'type',
    'targetId',
    'kind',
    'id',
    'planId',
    'workoutId',
    'date',
    'limit',
    'offset',
    'cursor',
  ];
  for (const [name, value] of url.searchParams) {
    if (
      !allowed.includes(name) ||
      value.length > 200 ||
      url.searchParams.getAll(name).length !== 1
    )
      return false;
  }
  return url.pathname.length + url.search.length <= 2000;
}
