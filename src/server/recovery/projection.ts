import 'server-only';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { HealthAutoExportSample } from '@/contracts/health-auto-export';
import { healthRangeDates } from '@/contracts/health';
import {
  recoveryUnits,
  type RecoveryDay,
  type RecoveryHistory,
  type RecoveryMetric,
  type RecoveryRange,
} from '@/contracts/recovery';
import { projectSleep } from './sleep';

dayjs.extend(utc);
dayjs.extend(timezone);

type MetricAccumulator = {
  value: number;
  count: number;
  firstAt: string;
  lastAt: string;
  sources: Set<string>;
};
type Metrics = Partial<Record<RecoveryMetric, MetricAccumulator>>;
type NightWindow = { start: number; end: number; date: string };

function findNight(windows: NightWindow[], sample: HealthAutoExportSample) {
  const start = Date.parse(sample.startAt);
  const end = Date.parse(sample.endAt);
  let low = 0;
  let high = windows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (windows[middle]!.start <= start) low = middle + 1;
    else high = middle;
  }
  const window = windows[low - 1];
  return window && start < window.end && end <= window.end ? window.date : null;
}

function observe(
  metrics: Metrics,
  metric: RecoveryMetric,
  value: number,
  { startAt, endAt, source }: HealthAutoExportSample,
  duplicate: boolean,
) {
  const aggregate = (metrics[metric] ??= {
    value,
    count: 0,
    firstAt: startAt,
    lastAt: endAt,
    sources: new Set(),
  });
  if (!duplicate) {
    aggregate.count++;
    aggregate.value += (value - aggregate.value) / aggregate.count;
    if (startAt < aggregate.firstAt) aggregate.firstAt = startAt;
    if (endAt > aggregate.lastAt) aggregate.lastAt = endAt;
  }
  if (source) aggregate.sources.add(source);
}

function summarize(metrics: Metrics): RecoveryDay['metrics'] {
  return Object.fromEntries(
    (Object.keys(metrics) as RecoveryMetric[]).map((metric) => {
      const { sources, ...aggregate } = metrics[metric]!;
      return [
        metric,
        {
          ...aggregate,
          unit: recoveryUnits[metric],
          sources: [...sources].sort(),
        },
      ];
    }),
  );
}

export function projectRecovery(
  range: RecoveryRange,
  samples: readonly HealthAutoExportSample[],
): RecoveryHistory {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: range.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const localDate = (instant: string | number) => {
    const parts = formatter.formatToParts(
      typeof instant === 'number' ? instant : new Date(instant),
    );
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const dates = healthRangeDates({ from: range.from, to: range.to });
  const byDate = new Map<
    string,
    { date: string; sleep: RecoveryDay['sleep']; metrics: Metrics }
  >(dates.map((date) => [date, { date, sleep: [], metrics: {} }]));
  const nightWindows: NightWindow[] = [];
  const nightBounds = new Map<string, { morning: number; evening: number }>();
  function overlapsLocalNight({ start, end }: { start: number; end: number }) {
    const date = localDate(start);
    let bounds = nightBounds.get(date);
    if (!bounds) {
      bounds = {
        morning: dayjs.tz(`${date}T06:00:00`, range.timezone).valueOf(),
        evening: dayjs.tz(`${date}T22:00:00`, range.timezone).valueOf(),
      };
      nightBounds.set(date, bounds);
    }
    return start < bounds.morning || end > bounds.evening;
  }
  let totalSleepDuration = 0;
  let episodes = 0;
  for (const { episode, windows } of projectSleep(samples)) {
    const date = localDate(episode.endAt);
    const day = byDate.get(date);
    if (!day) continue;
    const isNight = windows.some(overlapsLocalNight);
    day.sleep.push({ ...episode, isNight });
    if (isNight) {
      for (const window of windows) nightWindows.push({ ...window, date });
    }
    totalSleepDuration += episode.durationSeconds;
    episodes++;
  }

  const rangeMetrics: Metrics = {};
  const seen = new Set<string>();
  for (const sample of samples) {
    const { value, metric } = sample;
    if (value === null || metric === 'sleep_analysis') continue;
    const observedMetric =
      metric === 'heart_rate' ? 'night_heart_rate' : metric;
    if (sample.unit !== recoveryUnits[observedMetric]) continue;
    const date =
      metric === 'heart_rate'
        ? findNight(nightWindows, sample)
        : localDate(sample.startAt);
    const day = date ? byDate.get(date) : undefined;
    if (day) {
      const identity = JSON.stringify([
        observedMetric,
        sample.startAt,
        sample.endAt,
        value,
      ]);
      const duplicate = seen.has(identity);
      seen.add(identity);
      observe(day.metrics, observedMetric, value, sample, duplicate);
      observe(rangeMetrics, observedMetric, value, sample, duplicate);
    }
  }

  const days = [...byDate.values()].map(({ date, sleep, metrics }) => ({
    date,
    sleep,
    metrics: summarize(metrics),
  }));
  const observedSleepDays = days.filter((day) => day.sleep.length).length;
  return {
    range,
    source: 'HEALTH_AUTO_EXPORT',
    days,
    summary: {
      observedDays: days.filter(
        (day) => day.sleep.length || Object.keys(day.metrics).length,
      ).length,
      sleep: {
        nights: days.filter((day) =>
          day.sleep.some((episode) => episode.isNight),
        ).length,
        observedDays: observedSleepDays,
        episodes,
        averageDurationSeconds: observedSleepDays
          ? totalSleepDuration / observedSleepDays
          : null,
      },
      metrics: summarize(rangeMetrics),
    },
  };
}
