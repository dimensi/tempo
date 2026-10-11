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
