import {
  analyticsRangeSchema,
  type AnalyticsRange,
} from '@/contracts/analytics';
export type AnalyticsPreset =
  'previousWeek' | 'currentWeek' | 'previousMonth' | 'currentMonth';

export function presetRange(
  preset: AnalyticsPreset,
  today: string,
): AnalyticsRange {
  // Work on calendar dates after resolving today in the user's timezone.
  // UTC arithmetic here avoids DST shifts and the server's local timezone.
  const from = new Date(`${today}T00:00:00Z`);
  let to = today;
  switch (preset) {
    case 'previousWeek':
    case 'currentWeek': {
      const daysSinceMonday = (from.getUTCDay() + 6) % 7;
      from.setUTCDate(from.getUTCDate() - daysSinceMonday);
      if (preset === 'previousWeek') {
        from.setUTCDate(from.getUTCDate() - 1);
        to = from.toISOString().slice(0, 10);
        from.setUTCDate(from.getUTCDate() - 6);
      }
      break;
    }
    case 'previousMonth':
      from.setUTCDate(0);
      to = from.toISOString().slice(0, 10);
      from.setUTCDate(1);
      break;
    case 'currentMonth':
      from.setUTCDate(1);
      break;
  }
  return analyticsRangeSchema.parse({
    from: from.toISOString().slice(0, 10),
    to,
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
