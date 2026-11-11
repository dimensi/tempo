import type { ProgressOccurrence } from '@/contracts/exercise-progress';
import type { WorkoutSet } from '@/contracts/workouts';
import { progressMessages as m } from './messages';

export function numberLabel(value: number) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
export function setLabel(set: WorkoutSet) {
  return `${set.weightKg === null ? m.noWeight : `${numberLabel(set.weightKg)} ${m.kg}`} × ${set.reps}`;
}
export function metricLabel(
  metric: ProgressOccurrence['sets'][number]['metrics'][number],
) {
  return `${metric.name}: ${metric.values.join(' / ') || '—'} ${metric.unit} · ${m.metricType}: ${metric.type}`;
}
export function setsLabel(row: ProgressOccurrence) {
  if (row.sets.some((set) => !set.value))
    return row.sets
      .map((set) =>
        set.value
          ? setLabel(set.value)
          : set.metrics.map((metric) => metricLabel(metric)).join('; '),
      )
      .join(' · ');
  const values = row.sets.map((set) => set.value!);
  if (values.every((set) => set.weightKg === values[0]?.weightKg))
    return `${values[0]!.weightKg === null ? m.noWeight : `${numberLabel(values[0]!.weightKg)} ${m.kg}`} × ${values.map((set) => set.reps).join(', ')}`;
  return values.map(setLabel).join(' · ');
}
