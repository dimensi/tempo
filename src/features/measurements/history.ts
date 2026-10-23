import type { Measurement, MeasurementMetric } from '@/contracts/measurements';
import type { WeightHistory } from '@/contracts/health';
import type { MeasurementPrecisionIssue } from '@/contracts/yazio-body';
import { canonicalYazioBodyValue } from '@/lib/yazio-observations';

export function groupPrecisionIssues(issues: MeasurementPrecisionIssue[]) {
  const groups = new Map<
    string,
    {
      key: string;
      metric: MeasurementPrecisionIssue['metric'];
      date: string;
      value: string;
      observations: MeasurementPrecisionIssue[];
    }
  >();
  for (const issue of [...issues].sort(
    (a, b) => a.dateTime.localeCompare(b.dateTime) || a.id.localeCompare(b.id),
  )) {
    const key = JSON.stringify([issue.metric, issue.date, issue.value]);
    const group = groups.get(key) ?? {
      key,
      metric: issue.metric,
      date: issue.date,
      value: issue.value,
      observations: [],
    };
    group.observations.push(issue);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Pair source observations by date without averaging, selecting a last value,
// or collapsing same-day records. Distinct observations retain distinct slots.
export function weightTrendChart(history: WeightHistory) {
  return [
    ...history.local.map((record) => ({
      date: record.measuredAt,
      value: Number(record.value),
    })),
    ...history.imported.map((record) => ({
      date: record.measuredAt,
      value:
        record.rawValue === null
          ? null
          : Number(canonicalYazioBodyValue(record.rawValue) ?? record.rawValue),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function measurementChange(
  items: Measurement[],
  item: Measurement,
  metric: MeasurementMetric,
): string | null {
  const current = item.values.find((v) => v.metric === metric);
  const previous = items
    .filter((v) => v.measuredAt < item.measuredAt)
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))
    .flatMap((v) => v.values.filter((x) => x.metric === metric))[0];
  if (!current || !previous) return null;
  const difference =
    Math.round((Number(current.value) - Number(previous.value)) * 1000) / 1000;
  return `${difference > 0 ? '+' : ''}${difference}`;
}
