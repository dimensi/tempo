import 'server-only';
import type { HealthAutoExportSample } from '@/contracts/health-auto-export';
import type {
  RecoverySleepEpisode,
  RecoverySleepStage,
} from '@/contracts/recovery';

type Window = { start: number; end: number };
type SleepInterval = Window & { source: string | null };
type StageInterval = SleepInterval & { stage: RecoverySleepStage };

const episodeGap = 90 * 60 * 1000;
const namedStages = ['core', 'deep', 'rem'] as const;

function extendCoverage(windows: Window[], start: number, end: number) {
  const last = windows.at(-1);
  if (last && start <= last.end) last.end = Math.max(last.end, end);
  else windows.push({ start, end });
}

function stageCoverage(intervals: StageInterval[]) {
  const events = intervals
    .flatMap(({ start, end, stage }) => [
      { at: start, stage, delta: 1 },
      { at: end, stage, delta: -1 },
    ])
    .sort((a, b) => a.at - b.at);
  const active = { core: 0, deep: 0, rem: 0, unspecified: 0 };
  const windows: Window[] = [];
  const stages: RecoverySleepEpisode['stages'] = {};
  let durationSeconds = 0;
  for (const [index, event] of events.entries()) {
    active[event.stage] += event.delta;
    const end = events[index + 1]?.at;
    if (end === undefined || end <= event.at) continue;
    const named = namedStages.filter((stage) => active[stage] > 0);
    if (!named.length && !active.unspecified) continue;

    // Concrete categories take precedence over generic sleep. Conflicts stay unclassified.
    const stage = named.length === 1 ? named[0]! : 'unspecified';
    const seconds = (end - event.at) / 1000;
    stages[stage] = (stages[stage] ?? 0) + seconds;
    durationSeconds += seconds;
    extendCoverage(windows, event.at, end);
  }
  return { windows, stages, durationSeconds };
}

function observedWithin(intervals: SleepInterval[]) {
  let first = 0;
  return ({ start, end }: Window, sources: Set<string>) => {
    while (first < intervals.length && intervals[first]!.end <= start) first++;
    const covered: Window[] = [];
    for (let index = first; index < intervals.length; index++) {
      const interval = intervals[index]!;
      if (interval.start >= end) break;
      if (interval.end <= start) continue;
      if (interval.source) sources.add(interval.source);
      extendCoverage(
        covered,
        Math.max(start, interval.start),
        Math.min(end, interval.end),
      );
    }
    return covered.length
      ? covered.reduce((total, part) => total + (part.end - part.start), 0) /
          1000
      : null;
  };
}

export function projectSleep(samples: readonly HealthAutoExportSample[]) {
  const asleep: StageInterval[] = [];
  const awake: SleepInterval[] = [];
  const inBed: SleepInterval[] = [];
  for (const sample of samples) {
    if (
      sample.metric !== 'sleep_analysis' ||
      !sample.stage ||
      sample.stage === 'unspecified'
    )
      continue;
    const interval = {
      start: Date.parse(sample.startAt),
      end: Date.parse(sample.endAt),
      source: sample.source,
    };
    if (sample.stage === 'awake') awake.push(interval);
    else if (sample.stage === 'in_bed') inBed.push(interval);
    else
      asleep.push({
        ...interval,
        stage: sample.stage === 'asleep' ? 'unspecified' : sample.stage,
      });
  }
  const byStart = (a: Window, b: Window) => a.start - b.start;
  const awakeWithin = observedWithin(awake.sort(byStart));
  const inBedWithin = observedWithin(inBed.sort(byStart));
  const groups: (Window & { intervals: StageInterval[] })[] = [];
  for (const interval of asleep.sort(byStart)) {
    const last = groups.at(-1);
    if (last && interval.start - last.end <= episodeGap) {
      last.end = Math.max(last.end, interval.end);
      last.intervals.push(interval);
    } else
      groups.push({
        start: interval.start,
        end: interval.end,
        intervals: [interval],
      });
  }

  return groups.map((group) => {
    const { windows, durationSeconds, stages } = stageCoverage(group.intervals);
    const sources = new Set(
      group.intervals.flatMap(({ source }) => (source ? [source] : [])),
    );
    const episode: RecoverySleepEpisode = {
      startAt: new Date(group.start).toISOString(),
      endAt: new Date(group.end).toISOString(),
      durationSeconds,
      stages,
      awakeSeconds: awakeWithin(group, sources),
      inBedSeconds: inBedWithin(group, sources),
      sources: [...sources].sort(),
    };
    return { episode, windows };
  });
}
