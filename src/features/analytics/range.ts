import {
  analyticsRangeSchema,
  type AnalyticsRange,
} from '@/contracts/analytics';
export function presetRange(
  preset: 'week' | 'month' | 'quarter',
  today: string,
): AnalyticsRange {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(
    date.getUTCDate() - (preset === 'week' ? 6 : preset === 'month' ? 29 : 89),
  );
  return analyticsRangeSchema.parse({
    from: date.toISOString().slice(0, 10),
    to: today,
  });
}
export function rangeDates(range: AnalyticsRange): string[] {
  const { from, to } = analyticsRangeSchema.parse(range);
  const dates: string[] = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += 86400000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

export function previousRange(range: AnalyticsRange): AnalyticsRange {
  const length = rangeDates(range).length;
  const to = new Date(Date.parse(range.from) - 86400000)
    .toISOString()
    .slice(0, 10);
  const from = new Date(Date.parse(range.from) - length * 86400000)
    .toISOString()
    .slice(0, 10);
  return analyticsRangeSchema.parse({ from, to });
}
