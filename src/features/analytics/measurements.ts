import type { BodyObservation } from '@/contracts/analytics';
import { toChartNumber } from '@/lib/number-display';
import type { Measurement } from '@/contracts/measurements';
import type { AnalyticsRange } from '@/contracts/analytics';
export function measurementsInRange(
  range: AnalyticsRange,
  records: Measurement[],
) {
  return records
    .filter(
      (record) =>
        record.measuredAt >= range.from && record.measuredAt <= range.to,
    )
    .sort(
      (a, b) =>
        a.measuredAt.localeCompare(b.measuredAt) || a.id.localeCompare(b.id),
    );
}

export function bodyChart(observations: BodyObservation[]) {
  const byDate = new Map<
    string,
    { local: BodyObservation[]; yazio: BodyObservation[] }
  >();
  observations.forEach((record) => {
    const row = byDate.get(record.date) ?? { local: [], yazio: [] };
    row[record.source === 'LOCAL' ? 'local' : 'yazio'].push(record);
    byDate.set(record.date, row);
  });
  const rows: Array<{
    date: string;
    time: number;
    local: number | null;
    yazio: number | null;
  }> = [];
  let previous: string | null = null;
  [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, values]) => {
      if (previous && (Date.parse(date) - Date.parse(previous)) / 86400000 > 7)
        rows.push({
          date: new Date(Date.parse(previous) + 86400000)
            .toISOString()
            .slice(0, 10),
          time: Date.parse(previous) + 86400000,
          local: null,
          yazio: null,
        });
      Array.from(
        { length: Math.max(values.local.length, values.yazio.length) },
        (_, index) =>
          rows.push({
            date,
            time: Date.parse(date),
            local: toChartNumber(values.local[index]?.value ?? null),
            yazio: toChartNumber(values.yazio[index]?.value ?? null),
          }),
      );
      previous = date;
    });
  return rows;
}
