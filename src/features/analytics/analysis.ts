import Decimal from 'decimal.js';
import { canonicalYazioBodyValue } from '@/lib/yazio-observations';
import type { NutritionDay } from '@/contracts/nutrition';
import type {
  AnalyticsChange,
  AnalyticsRange,
  BodyAnalysis,
  BodyObservation,
  MeasurementAnalysis,
  NutritionAnalysis,
} from '@/contracts/analytics';
import { measurementMetrics, type Measurement } from '@/contracts/measurements';
import type { WeightHistory } from '@/contracts/health';
import { summarizeNutrition } from './summary';
import { rangeDates } from './range';

const D = Decimal.clone({ precision: 80 });
function exactDifference(current: string, previous: string) {
  const values = [new D(current), new D(previous)];
  const highest = Math.max(...values.map((value) => value.e));
  const lowest = Math.min(...values.map((value) => value.e - value.sd() + 1));
  const Exact = D.clone({ precision: Math.max(80, highest - lowest + 3) });
  return new Exact(current).minus(previous).toString();
}
const macros = ['protein', 'fat', 'carbs'] as const;
export function analyzeNutrition(
  range: AnalyticsRange,
  input: NutritionDay[],
): NutritionAnalysis {
  const summary = summarizeNutrition(range, input);
  const records = new Map(input.map((day) => [day.date, day]));
  const days = summary.days.map((day) => {
    const record = records.get(day.date);
    const hasEntries =
      record?.meals.some((meal) => meal.entries.length > 0) ?? false;
    const quality = !record
      ? 'missing'
      : !hasEntries
        ? 'empty'
        : Object.values(day.totals).every((value) => value !== null)
          ? 'complete'
          : 'partial';
    return { ...day, quality } as NutritionAnalysis['days'][number];
  });
  // A saved empty diary is not evidence of a day of fasting. Preserve its raw
  // zero values for audit, but exclude it from filled-day analytics.
  const eligible = days.filter(
    (day) => day.quality !== 'missing' && day.quality !== 'empty',
  );
  const eligibleSummary = summarizeNutrition(
    range,
    input.filter((day) => eligible.some((item) => item.date === day.date)),
  );
  const macroDays = eligible.filter((day) =>
    macros.every((key) => day.totals[key] !== null),
  );
  const macroSummary = summarizeNutrition(
    range,
    input.filter((day) => macroDays.some((item) => item.date === day.date)),
  );
  const averages = Object.fromEntries(
    macros.map((key) => [key, macroSummary.nutrients[key].mean]),
  ) as NutritionAnalysis['macros']['averages'];
  const energy = macros.map((key) =>
    new D(macroSummary.nutrients[key].total ?? 0).mul(key === 'fat' ? 9 : 4),
  );
  const totalEnergy = energy.reduce((sum, value) => sum.plus(value), new D(0));
  const energyShares = Object.fromEntries(
    macros.map((key, index) => [
      key,
      totalEnergy.isZero()
        ? null
        : energy[index]!.div(totalEnergy).mul(100).toString(),
    ]),
  ) as NutritionAnalysis['macros']['energyShares'];
  return {
    summary: eligibleSummary,
    days,
    completeDays: days.filter((day) => day.quality === 'complete').length,
    partialDays: days.filter((day) => day.quality === 'partial').length,
    emptyDays: days.filter((day) => day.quality === 'empty').length,
    missingDays: days.filter((day) => day.quality === 'missing').length,
    calorieDays: eligibleSummary.nutrients.calories.confirmedDays,
    calorieMean: eligibleSummary.nutrients.calories.mean,
    macros: { days: macroDays.length, averages, energyShares },
    updatedAt:
      input
        .filter((day) => day.date >= range.from && day.date <= range.to)
        .map((day) => day.fetchedAt)
        .sort()
        .at(-1) ?? null,
  };
}
export function compareMeans(
  current: string | null,
  previous: string | null,
  currentDays: number,
  previousDays: number,
  calendarDays: number,
): AnalyticsChange | null {
  if (
    current === null ||
    previous === null ||
    currentDays / calendarDays < 0.7 ||
    previousDays / calendarDays < 0.7
  )
    return null;
  const delta = exactDifference(current, previous);
  return {
    delta,
    percent: new D(previous).isZero()
      ? null
      : new D(delta).div(previous).mul(100).toString(),
  };
}
export function analyzeObservations(
  range: AnalyticsRange,
  observations: BodyObservation[],
): MeasurementAnalysis {
  const sorted = [...observations].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const valid = sorted.filter((record) => record.value !== null);
  const first = valid[0] ?? null;
  const latest = valid.at(-1) ?? null;
  // Date-only observations have no order within a day. Do not pick a source or
  // average conflicting endpoint observations to manufacture a change.
  const endpointAmbiguous = (record: BodyObservation | null) =>
    record !== null &&
    new Set(
      valid
        .filter((item) => item.date === record.date)
        .map((item) => new D(item.value!).toString()),
    ).size > 1;
  const ambiguousEndpoints =
    endpointAmbiguous(first) || endpointAmbiguous(latest);
  const elapsedDays =
    first && latest
      ? (Date.parse(latest.date) - Date.parse(first.date)) / 86400000
      : 0;
  const delta =
    first && latest && elapsedDays > 0 && !ambiguousEndpoints
      ? exactDifference(latest.value!, first.value!)
      : null;
  return {
    observations: sorted,
    first: endpointAmbiguous(first) ? null : first,
    latest: endpointAmbiguous(latest) ? null : latest,
    delta,
    weeklyRate:
      delta !== null && rangeDates(range).length >= 7
        ? new D(delta).mul(7).div(elapsedDays).toString()
        : null,
    ambiguousEndpoints,
  };
}
export function analyzeBody(
  range: AnalyticsRange,
  records: Measurement[],
  history: WeightHistory,
): BodyAnalysis {
  const measurements = records
    .filter(
      (record) =>
        record.measuredAt >= range.from && record.measuredAt <= range.to,
    )
    .map(({ id, measuredAt, values }) => ({ id, measuredAt, values }));
  const metrics = Object.fromEntries(
    measurementMetrics.map((metric) => {
      const observations: BodyObservation[] = measurements.flatMap((record) =>
        record.values
          .filter((value) => value.metric === metric)
          .map((value) => ({
            id: record.id,
            date: record.measuredAt,
            value: value.value,
            source: 'LOCAL' as const,
          })),
      );
      if (metric === 'weight')
        history.imported.forEach((record, index) =>
          observations.push({
            id: `yazio-${index}`,
            date: record.measuredAt,
            value:
              record.rawValue === null
                ? null
                : (canonicalYazioBodyValue(record.rawValue) ?? record.rawValue),
            rawValue: record.rawValue,
            source: 'YAZIO',
          }),
        );
      return [metric, analyzeObservations(range, observations)];
    }),
  ) as BodyAnalysis['metrics'];
  return { measurements, metrics };
}
