import 'server-only';
import { dailyGoalsRepository } from '@/server/yazio/goals';
import type { NutritionDay } from '@/contracts/nutrition';
import type { Measurement } from '@/contracts/measurements';
import type { StepsSummary, WeightHistory } from '@/contracts/health';
import {
  analyticsRangeSchema,
  type AnalyticsData,
  type AnalyticsRange,
  type AnalyticsHighlight,
} from '@/contracts/analytics';
import {
  timezoneSchema,
  dateInTimezone,
} from '@/contracts/nutrition-sync-dates';
import { authorize } from '@/server/auth/guards';
import {
  previousRange,
  analyzeNutrition,
  analyzeBody,
  compareMeans,
} from '@/features/analytics';

export class AnalyticsError extends Error {
  constructor(public readonly status: number) {
    super('Analytics unavailable');
  }
}
export interface AnalyticsSources {
  listNutritionDays(
    headers: Headers,
    ownerId: string,
    range: AnalyticsRange,
  ): Promise<NutritionDay[]>;
  listMeasurements(headers: Headers, ownerId: string): Promise<Measurement[]>;
  weight(headers: Headers, range: AnalyticsRange): Promise<WeightHistory>;
  steps(
    headers: Headers,
    ownerId: string,
    range: AnalyticsRange,
  ): Promise<{ summary: StepsSummary; updatedAt: string | null }>;
}
export async function loadAnalytics(
  headers: Headers,
  ownerId: string,
  input: unknown,
  sources: AnalyticsSources,
  timezoneInput: unknown = 'UTC',
  now = new Date(),
): Promise<AnalyticsData> {
  async function checkAccess() {
    let owner = false;
    for (const permission of ['nutrition:read', 'measurements:read'] as const) {
      const access = await authorize(headers, permission, ownerId);
      if (!access.ok) throw new AnalyticsError(access.status);
      owner = access.session.user.role === 'OWNER';
    }
    return owner;
  }
  await checkAccess();
  const parsed = analyticsRangeSchema.safeParse(input);
  const timezone = timezoneSchema.safeParse(timezoneInput);
  if (!parsed.success || !timezone.success) throw new AnalyticsError(400);
  const range = parsed.data;
  const previous = previousRange(range);
  const [nutrition, priorNutrition, body, activity, priorActivity] =
    await Promise.allSettled([
      sources
        .listNutritionDays(headers, ownerId, range)
        .then((days) => analyzeNutrition(range, days)),
      sources
        .listNutritionDays(headers, ownerId, previous)
        .then((days) => analyzeNutrition(previous, days)),
      Promise.all([
        sources.listMeasurements(headers, ownerId),
        sources.weight(headers, range),
      ]).then(([records, history]) => analyzeBody(range, records, history)),
      sources.steps(headers, ownerId, range),
      sources.steps(headers, ownerId, previous),
    ]);
  // Never turn denial/revocation into a partial successful response.
  const canSync = await checkAccess();
  for (const result of [
    nutrition,
    priorNutrition,
    body,
    activity,
    priorActivity,
  ]) {
    if (
      result.status === 'rejected' &&
      [401, 403].includes(result.reason?.status)
    )
      throw new AnalyticsError(result.reason.status);
  }
  const calendarDays =
    (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
  const calorieChange =
    nutrition.status === 'fulfilled' && priorNutrition.status === 'fulfilled'
      ? compareMeans(
          nutrition.value.calorieMean,
          priorNutrition.value.calorieMean,
          nutrition.value.completeDays,
          priorNutrition.value.completeDays,
          calendarDays,
        )
      : null;
  const stepsChange =
    activity.status === 'fulfilled' && priorActivity.status === 'fulfilled'
      ? compareMeans(
          activity.value.summary.averageSteps,
          priorActivity.value.summary.averageSteps,
          activity.value.summary.observedDays,
          priorActivity.value.summary.observedDays,
          calendarDays,
        )
      : null;
  const highlights: AnalyticsHighlight[] = [];
  if (body.status === 'fulfilled' && body.value.metrics.weight.delta !== null)
    highlights.push({ kind: 'weight', value: body.value.metrics.weight.delta });
  if (calorieChange)
    highlights.push({ kind: 'calories', value: calorieChange.delta });
  if (stepsChange) highlights.push({ kind: 'steps', value: stepsChange.delta });
  if (
    nutrition.status === 'fulfilled' &&
    nutrition.value.completeDays < calendarDays
  )
    highlights.push({
      kind: 'nutritionQuality',
      value: String(calendarDays - nutrition.value.completeDays),
    });
  else if (
    activity.status === 'fulfilled' &&
    activity.value.summary.observedDays < calendarDays
  )
    highlights.push({
      kind: 'stepsQuality',
      value: String(calendarDays - activity.value.summary.observedDays),
    });
  return {
    goals: dailyGoalsRepository().list(ownerId, range),
    range,
    previousRange: previous,
    today: dateInTimezone(now, timezone.data),
    timezone: timezone.data,
    canSync,
    highlights: highlights.slice(0, 4),
    nutrition:
      nutrition.status === 'fulfilled'
        ? {
            state: 'ready',
            data: nutrition.value,
            comparison: calorieChange,
            comparisonUnavailable: priorNutrition.status === 'rejected',
          }
        : { state: 'error' },
    body:
      body.status === 'fulfilled'
        ? {
            state: 'ready',
            data: body.value,
            comparison: null,
            comparisonUnavailable: false,
          }
        : { state: 'error' },
    activity:
      activity.status === 'fulfilled'
        ? {
            state: 'ready',
            data: activity.value,
            comparison: stepsChange,
            comparisonUnavailable: priorActivity.status === 'rejected',
          }
        : { state: 'error' },
  };
}
