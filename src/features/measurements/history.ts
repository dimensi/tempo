import type { Measurement, MeasurementMetric } from '@/contracts/measurements';
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
