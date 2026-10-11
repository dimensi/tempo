import {
  analyticsRangeSchema,
  type AnalyticsRange,
} from '@/contracts/analytics';
export function presetRange(
  preset: 'week' | 'month',
  today: string,
): AnalyticsRange {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (preset === 'week' ? 6 : 29));
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
