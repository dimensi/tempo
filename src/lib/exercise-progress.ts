import type {
  ProgressOccurrence,
  ProgressStats,
} from '@/contracts/exercise-progress';
import type { WorkoutSet } from '@/contracts/workouts';

export function progressRange(to: string, days: number) {
  return {
    from: new Date(Date.parse(to) - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    to,
  };
}
export function previousDate(date: string) {
  return new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
}
export function bestSet(sets: WorkoutSet[]): WorkoutSet | null {
  return (
    [...sets].sort(
      (a, b) => (b.weightKg ?? -1) - (a.weightKg ?? -1) || b.reps - a.reps,
    )[0] ?? null
  );
}
export function occurrenceStats(row: ProgressOccurrence): ProgressStats {
  const values = row.sets.flatMap((set) => (set.value ? [set.value] : []));
  const allKnown =
    row.sets.length > 0 &&
    values.length === row.sets.length &&
    values.every((set) => set.weightKg !== null);
  const repetitions = new Map<number | null, number>();
  for (const set of values)
    repetitions.set(
      set.weightKg,
      Math.max(repetitions.get(set.weightKg) ?? 0, set.reps),
    );
  return {
    key: row.key,
    date: row.date,
    source: row.source,
    best: bestSet(values),
    volume: allKnown
      ? values.reduce((sum, set) => sum + set.weightKg! * set.reps, 0)
      : null,
    repetitions: [...repetitions].map(([weightKg, reps]) => ({
      weightKg,
      reps,
    })),
  };
}
/** Applying history changes only the set values; occurrence identity and assessments stay intact. */
export function repeatExerciseSets<T extends { sets: unknown[] }>(
  exercise: T,
  occurrence: ProgressOccurrence,
): T | null {
  if (
    !occurrence.sets.length ||
    occurrence.sets.length > 50 ||
    occurrence.sets.some((set) => !set.value)
  )
    return null;
  return {
    ...exercise,
    sets: occurrence.sets.map((set) => ({ ...set.value! })),
  };
}
