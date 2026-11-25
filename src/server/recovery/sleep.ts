import 'server-only';
import type { HealthAutoExportSample } from '@/contracts/health-auto-export';
import type {
  RecoverySleepEpisode,
  RecoverySleepStage,
} from '@/contracts/recovery';

type Window = { start: number; end: number };
type SleepInterval = Window & { source: string | null };
type StageInterval = SleepInterval & {
  stage: RecoverySleepStage | 'awake';
};
type SleepGroup = Window & {
  windows: Window[];
  stages: RecoverySleepEpisode['stages'];
  durationSeconds: number;
};

const episodeGap = 90 * 60 * 1000;
const namedStages = ['core', 'deep', 'rem'] as const;

function extendCoverage(windows: Window[], start: number, end: number) {
  const last = windows.at(-1);
  if (last && start <= last.end) last.end = Math.max(last.end, end);
  else windows.push({ start, end });
}

function* confirmedSleepSpans(intervals: StageInterval[]) {
  const events = intervals
    .flatMap(({ start, end, stage }) => [
      { at: start, stage, delta: 1 },
      { at: end, stage, delta: -1 },
    ])
    .sort((a, b) => a.at - b.at);
  const active = { core: 0, deep: 0, rem: 0, unspecified: 0, awake: 0 };
  for (const [index, event] of events.entries()) {
    active[event.stage] += event.delta;
    const end = events[index + 1]?.at;
    // Awake observations break confirmed sleep even when another source reports sleep.
    if (end === undefined || end <= event.at || active.awake > 0) continue;
    const named = namedStages.filter((stage) => active[stage] > 0);
    if (!named.length && !active.unspecified) continue;

    // Concrete categories take precedence over generic sleep. Conflicts stay unclassified.
    const stage: RecoverySleepStage =
      named.length === 1 ? named[0]! : 'unspecified';
    yield { start: event.at, end, stage };
  }
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
  const stages: StageInterval[] = [];
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
    if (sample.stage === 'in_bed') {
      inBed.push(interval);
    } else {
      const stage: StageInterval = {
        ...interval,
        stage: sample.stage === 'asleep' ? 'unspecified' : sample.stage,
      };
      stages.push(stage);
      if (stage.stage === 'awake') awake.push(stage);
      else asleep.push(stage);
    }
  }
  const byStart = (a: Window, b: Window) => a.start - b.start;
  const awakeWithin = observedWithin(awake.sort(byStart));
  const inBedWithin = observedWithin(inBed.sort(byStart));
  const asleepWithin = observedWithin(asleep.sort(byStart));
  const groups: SleepGroup[] = [];
  for (const { start, end, stage } of confirmedSleepSpans(stages)) {
    let group = groups.at(-1);
    if (!group || start - group.end > episodeGap) {
      group = { start, end, windows: [], stages: {}, durationSeconds: 0 };
      groups.push(group);
    }
    group.end = end;
    const seconds = (end - start) / 1000;
    group.stages[stage] = (group.stages[stage] ?? 0) + seconds;
    group.durationSeconds += seconds;
    extendCoverage(group.windows, start, end);
  }

  return groups.map((group) => {
    const sources = new Set<string>();
    asleepWithin(group, sources);
    const episode: Omit<RecoverySleepEpisode, 'isNight'> = {
      startAt: new Date(group.start).toISOString(),
      endAt: new Date(group.end).toISOString(),
      durationSeconds: group.durationSeconds,
      stages: group.stages,
      awakeSeconds: awakeWithin(group, sources),
      inBedSeconds: inBedWithin(group, sources),
      sources: [...sources].sort(),
    };
    return { episode, windows: group.windows };
  });
}
