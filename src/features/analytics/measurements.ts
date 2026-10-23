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
  const rows: Array<{ date: string; time: number; value: number | null }> = [];
  let previous: string | null = null;
  for (const record of [...observations].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  )) {
    if (
      previous &&
      (Date.parse(record.date) - Date.parse(previous)) / 86400000 > 7
    )
      rows.push({
        date: new Date(Date.parse(previous) + 86400000)
          .toISOString()
          .slice(0, 10),
        time: Date.parse(previous) + 86400000,
        value: null,
      });
    rows.push({
      date: record.date,
      time: Date.parse(record.date),
      value: toChartNumber(record.value),
    });
    previous = record.date;
  }
  return rows;
}
