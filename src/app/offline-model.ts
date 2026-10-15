import type { OfflineSnapshot } from '@/contracts/offline';
import type { NutritionDay } from '@/contracts/nutrition';
import type { Measurement } from '@/contracts/measurements';
import type { AnalyticsData, AnalyticsRange } from '@/contracts/analytics';
import type { OverviewData } from '@/contracts/overview';
import {
  analyzeNutrition,
  analyzeBody,
  compareMeans,
  previousRange,
  presetRange,
  summarizeNutrition,
} from '@/features/analytics';
import { summarizeSteps } from '@/lib/steps-summary';
import { shiftDate } from '@/contracts/nutrition-sync-dates';

export function savedDiaryDay(
  snapshot: OfflineSnapshot | undefined,
  date: string,
): NutritionDay | null {
  const day = snapshot?.diary.find((day) => day.date === date);
  return day
    ? {
        ...day,
        meals: day.meals.map((meal) => ({
          ...meal,
          entries: meal.entries.map(({ key, ...entry }) => ({
            ...entry,
            id: key,
            sourceId: null,
            addedAt: null,
            consumedAt: null,
            editedAt: null,
          })),
        })),
      }
    : null;
}
export function savedMeasurements(snapshot: OfflineSnapshot): Measurement[] {
  return snapshot.measurements.map((record) => ({
    measuredAt: record.measuredAt,
    values: record.values,
    note: record.note,
    id: record.key,
    ownerId: snapshot.partition,
    sync: [],
  }));
}
export function savedWeight(snapshot: OfflineSnapshot, range: AnalyticsRange) {
  const summary = snapshot.views.summary;
  return {
    range,
    local: (summary?.weight.local ?? []).filter(
      (row) => row.measuredAt >= range.from && row.measuredAt <= range.to,
    ),
    imported: (summary?.weight.imported ?? []).filter(
      (row) => row.measuredAt >= range.from && row.measuredAt <= range.to,
    ),
  };
}
export function savedAnalytics(
  snapshot: OfflineSnapshot,
  range: AnalyticsRange,
  today: string,
  timezone: string,
): AnalyticsData | null {
  const summary = snapshot.views.summary;
  if (!summary) return null;
  const previous = previousRange(range);
  const nutrition = analyzeNutrition(range, summary.nutrition);
  const priorNutrition = analyzeNutrition(previous, summary.nutrition);
  const activity = summarizeSteps(range, summary.steps);
  const priorActivity = summarizeSteps(previous, summary.steps);
  const covered = (period: AnalyticsRange) =>
    period.from >= summary.from && period.to <= summary.to;
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
  const bodyRecords = summary.body.map((row) => ({
    ...row,
    ownerId: snapshot.partition,
    sync: [],
    note: null,
  }));
  const body = analyzeBody(range, bodyRecords, savedWeight(snapshot, range));
  return {
    range,
    previousRange: previous,
    today,
    timezone,
    canSync: false,
    highlights: [],
    nutrition: {
      state: 'ready',
      data: nutrition,
      comparison:
        covered(range) && covered(previous)
          ? compareMeans(
              nutrition.calorieMean,
              priorNutrition.calorieMean,
              nutrition.completeDays,
              priorNutrition.completeDays,
              days,
            )
          : null,
      comparisonUnavailable: !covered(previous),
    },
    body: {
      state: 'ready',
      data: body,
      comparison: null,
      comparisonUnavailable: !summary.bodyComplete,
    },
    activity: {
      state: 'ready',
      data: {
        summary: activity,
        updatedAt:
          summary.steps
            .map((row) => row.observedAt)
            .sort()
            .at(-1) ?? null,
      },
      comparison:
        covered(range) && covered(previous)
          ? compareMeans(
              activity.averageSteps,
              priorActivity.averageSteps,
              activity.observedDays,
              priorActivity.observedDays,
              days,
            )
          : null,
      comparisonUnavailable: !covered(previous),
    },
  };
}
export function savedOverview(
  snapshot: OfflineSnapshot,
  today: string,
  timezone: string,
): OverviewData | null {
  const summary = snapshot.views.summary;
  if (!summary) return null;
  const nutrition = summarizeNutrition(
    presetRange('week', today),
    summary.nutrition,
  );
  const local = summary.weight.local
    .filter((row) => row.measuredAt <= today)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const latest = summary.latestWeight;
  const byDate = new Map(local.map((row) => [row.measuredAt, row.value]));
  return {
    today,
    timezone,
    nutrition: {
      today:
        summary.nutrition.find((row) => row.date === today)?.totals ?? null,
      meanCalories: nutrition.nutrients.calories.mean,
      recordedDays: nutrition.recordedDays,
      confirmedDays: nutrition.nutrients.calories.confirmedDays,
      partialDays: nutrition.nutrients.calories.partialDays,
    },
    weight: {
      latest: latest ? { date: latest.date, value: latest.value } : null,
      points: Array.from({ length: 30 }, (_, i) => {
        const date = shiftDate(today, i - 29);
        return { date, value: byDate.get(date) ?? null };
      }),
    },
    workouts: summary.workouts,
  };
}
