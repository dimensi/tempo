import { offlineLocalWindow } from './offline-retention';
import { offlineAnamnesisSchema } from './offline-anamnesis';
import { z } from 'zod';
import { nutritionDaySchema, nutritionTotalsSchema } from './nutrition';
import { measurementSchema } from './measurements';
import { weightHistorySchema, stepsSummarySchema } from './health';
import { stepsGoalSchema } from './steps-goal';
import { workoutPlanSchema, workoutSessionSchema } from './workouts';
import {
  anamnesisOverviewSchema,
  anamnesisMarkerSummarySchema,
  medicalMarkerSchema,
  medicalDocumentSchema,
  medicalObservationSchema,
  medicalObservationSourceSchema,
  medicalReportExportSchema,
} from './anamnesis';
const weightPoint = z.object({
  date: z.string(),
  value: z.string().nullable(),
});
const workout = z.object({ title: z.string(), date: z.string() }).nullable();
const workouts = z.object({
  data: z.object({
    plans: z.array(workoutPlanSchema),
    sessions: z.array(workoutSessionSchema),
  }),
});
const overview = z.object({
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
    latest: weightPoint.nullable(),
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
/** Only these explicit view contracts may reach disk. Never settings credentials, jobs or upstream payloads. */
export function readResponseSchema(path: string): z.ZodType | undefined {
  if (path === '/api/offline/anamnesis-local') return offlineAnamnesisSchema;
  if (path === '/api/comments')
    return z.array(
      z.object({
        id: z.string(),
        authorId: z.string(),
        authorName: z.string(),
        body: z.string().max(4000),
        parentId: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
        canEdit: z.boolean(),
      }),
    );
  if (path === '/api/overview') return overview;
  if (path === '/api/measurements') return z.array(measurementSchema);
  if (path === '/api/health/weight') return weightHistorySchema;
  if (path === '/api/health/steps') return stepsSummarySchema;
  if (path === '/api/settings/steps-goal') return stepsGoalSchema;
  if (path === '/api/nutrition/days') return z.array(nutritionDaySchema);
  if (/^\/api\/nutrition\/days\/\d{4}-\d{2}-\d{2}$/.test(path))
    return nutritionDaySchema;
  if (path === '/api/workouts') return workouts;
  if (path === '/api/anamnesis/overview') return anamnesisOverviewSchema;
  if (path === '/api/anamnesis/markers')
    return z.array(anamnesisMarkerSummarySchema);
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
    return z.array(
      z.object({
        observation: medicalObservationSchema,
        sources: z.array(medicalObservationSourceSchema),
      }),
    );
}
export const readRecordSchema = z
  .object({
    version: z.literal(1),
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
        row.version === 1 && now >= row.savedAt && now - row.touchedAt < ttl,
    )
    .sort((a, b) => b.touchedAt - a.touchedAt);
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

/** Detailed ordinary records obey their calendar window, medical history its separate visit policy. */
export function offlineReadBody(
  key: string,
  body: string,
  now = Date.now(),
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | undefined {
  const path = new URL(key, 'https://tempo.local').pathname;
  const { from, to } = offlineLocalWindow(now, timezone);
  const inside = (date: string) => date >= from && date <= to;
  const value: unknown = JSON.parse(body);
  if (path === '/api/nutrition/days')
    return JSON.stringify(
      z
        .array(nutritionDaySchema)
        .parse(value)
        .filter((row) => inside(row.date)),
    );
  if (/^\/api\/nutrition\/days\/\d{4}-\d{2}-\d{2}$/.test(path))
    return inside(path.slice(-10)) ? body : undefined;
  if (path === '/api/measurements')
    return JSON.stringify(
      z
        .array(measurementSchema)
        .parse(value)
        .filter((row) => inside(row.measuredAt)),
    );
  if (path === '/api/workouts') {
    const result = workouts.parse(value);
    result.data.sessions = result.data.sessions.filter((row) =>
      inside(row.date),
    );
    result.data.plans = result.data.plans.flatMap((plan) => {
      const selected = plan.workouts.filter((workout) => inside(workout.date));
      return selected.length ? [{ ...plan, workouts: selected }] : [];
    });
    return JSON.stringify(result);
  }
  return body;
}

export function isCacheableReadUrl(url: URL) {
  if (!readResponseSchema(url.pathname)) return false;
  const allowed = ['ownerId', 'from', 'to', 'timezone', 'type', 'targetId'];
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
