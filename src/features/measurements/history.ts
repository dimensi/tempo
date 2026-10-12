import type { Measurement, MeasurementMetric } from '@/contracts/measurements';
import type { WeightHistory } from '@/contracts/health';

// Pair source observations by date without averaging, selecting a last value,
// or collapsing same-day records. Distinct observations retain distinct slots.
export function weightTrendChart(history: WeightHistory) {
  const byDate = new Map<
    string,
    { local: (number | null)[]; yazio: (number | null)[] }
  >();
  const add = (
    date: string,
    source: 'local' | 'yazio',
    value: string | null,
  ) => {
    const row = byDate.get(date) ?? { local: [], yazio: [] };
    row[source].push(value === null ? null : Number(value));
    byDate.set(date, row);
  };
  history.local.forEach((record) =>
    add(record.measuredAt, 'local', record.value),
  );
  history.imported.forEach((record) =>
    add(record.measuredAt, 'yazio', record.rawValue),
  );
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, values]) =>
      Array.from(
        { length: Math.max(values.local.length, values.yazio.length) },
        (_, index) => ({
          date,
          local: values.local[index] ?? null,
          yazio: values.yazio[index] ?? null,
        }),
      ),
    );
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
