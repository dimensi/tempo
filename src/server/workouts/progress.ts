import 'server-only';
import { createHash } from 'node:crypto';
import {
  progressQuerySchema,
  progressSummarySchema,
  progressHistorySchema,
  type ProgressOccurrence,
  type ProgressQuery,
} from '@/contracts/exercise-progress';
import { workoutSetSchema } from '@/contracts/workouts';
import { bestSet, occurrenceStats } from '@/lib/exercise-progress';
import {
  listSavedWorkouts,
  requireWorkoutRead,
  SavedWorkoutRangeError,
} from './saved-read';
import {
  localView,
  linkedView,
  nativeView,
  type SetData,
} from './history-views';

function scalarSet(set: SetData) {
  if (set.metrics === undefined) {
    const value = workoutSetSchema.safeParse({
      reps: set.reps,
      weightKg: set.weightKg,
    });
    return value.success ? value.data : null;
  }
  // Saved linked projections without metric keys remain readable, never guessed by display name.
  const metrics = set.metrics;
  if (
    metrics.some(
      (m) =>
        m.type !== 'straight' ||
        m.values.length !== 1 ||
        !['weight', 'reps'].includes(m.key ?? ''),
    )
  )
    return null;
  const reps = metrics.filter((m) => m.key === 'reps');
  const weight = metrics.filter((m) => m.key === 'weight');
  if (
    reps.length !== 1 ||
    weight.length > 1 ||
    (weight.length &&
      !['kg', 'кг'].includes(weight[0]!.unit.trim().toLowerCase()))
  )
    return null;
  const number = (v: string) =>
    /^\d+(?:[.,]\d+)?$/.test(v.trim())
      ? Number(v.trim().replace(',', '.'))
      : NaN;
  const value = workoutSetSchema.safeParse({
    reps: number(reps[0]!.values[0]!),
    weightKg: weight.length ? number(weight[0]!.values[0]!) : null,
  });
  return value.success ? value.data : null;
}
async function occurrences(headers: Headers, input: ProgressQuery) {
  const query = progressQuerySchema.parse(input);
  const { ownerId, from, to } = query;
  const saved = await listSavedWorkouts(headers, ownerId, { from, to });
  const views = [
    ...saved.local.workouts.map(localView),
    ...saved.linked.map(linkedView),
    ...saved.native.map(nativeView),
  ];
  const matches = views.filter(
    (w) =>
      w.date >= from &&
      w.date <= to &&
      (!query.workoutId || w.workoutId !== query.workoutId) &&
      ['completed', 'in_progress'].includes(w.executionStatus),
  );
  const localIds = new Set(
    matches.filter((w) => w.source === 'LOCAL').map((w) => w.workoutId),
  );
  const linkedIds = new Set(
    matches
      .filter((w) => w.source === 'TransformMate')
      .flatMap((w) => (w.workoutId ? [w.workoutId] : [])),
  );
  const rows: ProgressOccurrence[] = [];
  let setCount = 0;
  for (const w of matches)
    for (const e of w.exercises) {
      const id = e.historyRef?.exerciseId;
      if (
        e.phase !== 'actual' ||
        id === undefined ||
        (query.exerciseId !== undefined && id !== query.exerciseId) ||
        (query.exerciseIds && !query.exerciseIds.includes(id))
      )
        continue;
      const sets = e.sets.filter(
        (set) =>
          set.metrics === undefined ||
          set.metrics.some((m) => m.values.some((v) => v.trim() !== '')) ||
          set.done === true,
      );
      if (!sets.length) continue;
      setCount += sets.length;
      if (setCount > 10000) throw new SavedWorkoutRangeError();
      const params = new URLSearchParams({ date: w.date });
      if (w.workoutRef.kind === 'workout')
        params.set('workout', w.workoutRef.id);
      else if (w.workoutRef.kind === 'native')
        params.set('workout', `native:${w.workoutRef.id}`);
      else {
        const local = saved.local.workouts.find(
          (workout) => workout.id === w.workoutId && workout.date === w.date,
        );
        params.set('workout', local?.id ?? `remote:${w.workoutRef.id}`);
      }
      rows.push({
        key: `${w.workoutRef.kind}:${w.workoutRef.id}:${e.occurrenceId}`,
        exerciseId: id,
        name: e.name,
        date: w.date,
        source: w.source,
        status: w.executionStatus as ProgressOccurrence['status'],
        href: `/workouts?${params}`,
        comment: e.comment ?? null,
        fatigue: e.fatigue ?? null,
        failure:
          e.failure === 'full' ||
          e.failure === 'partial' ||
          e.failure === 'none'
            ? e.failure
            : null,
        possibleOverlap:
          !!w.workoutId &&
          localIds.has(w.workoutId) &&
          linkedIds.has(w.workoutId),
        sets: sets.map((set) => ({
          order: set.order,
          value: scalarSet(set),
          metrics: set.metrics ?? [],
        })),
      });
    }
  await requireWorkoutRead(headers, ownerId);
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key),
  );
}
export async function readProgressSummary(
  headers: Headers,
  input: ProgressQuery,
) {
  const rows = (await occurrences(headers, input)).filter(
    (row) => row.status === 'completed',
  );
  const ids = [...new Set(rows.map((row) => row.exerciseId))];
  return progressSummarySchema.parse({
    version: 1,
    upstreamCompleteness: 'unknown',
    exercises: ids
      .map((exerciseId) => {
        const exercises = rows.filter((row) => row.exerciseId === exerciseId);
        return {
          exerciseId,
          name: exercises[0]!.name,
          sources: (['LOCAL', 'TransformMate'] as const).flatMap((source) => {
            const group = exercises.filter((row) => row.source === source);
            if (!group.length) return [];
            const latest = group[0]!;
            const previous = group[1] ?? null;
            const stats = occurrenceStats(latest);
            const prior = previous && occurrenceStats(previous);
            const weight = stats.best?.weightKg;
            const current = stats.repetitions.find(
              (set) => set.weightKg === weight,
            )?.reps;
            const before = prior?.repetitions.find(
              (set) => set.weightKg === weight,
            )?.reps;
            return [
              {
                source,
                latest,
                previous,
                completedCount: group.length,
                best: bestSet(
                  group.flatMap((row) =>
                    row.sets.flatMap((set) => (set.value ? [set.value] : [])),
                  ),
                ),
                repChange:
                  current !== undefined && before !== undefined
                    ? { weightKg: weight ?? null, current, previous: before }
                    : null,
              },
            ];
          }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  });
}
export async function readProgressHistory(
  headers: Headers,
  input: ProgressQuery,
) {
  const query = progressQuerySchema.parse(input);
  if (!query.exerciseId) throw new Error('Exercise is required');
  const rows = await occurrences(headers, query);
  const { cursor, ...bindingInput } = query;
  const binding = createHash('sha256')
    .update(JSON.stringify(bindingInput))
    .digest('hex')
    .slice(0, 16);
  const match = cursor?.match(/^(\d+):([a-f0-9]{16})$/);
  if (cursor && (!match || match[2] !== binding))
    throw new SavedWorkoutRangeError();
  const offset = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(offset) || offset > rows.length)
    throw new SavedWorkoutRangeError();
  const completed = rows.filter((row) => row.status === 'completed');
  return progressHistorySchema.parse({
    version: 1,
    upstreamCompleteness: 'unknown',
    records: rows.slice(offset, offset + 20),
    latest:
      offset === 0
        ? (['LOCAL', 'TransformMate'] as const).flatMap((source) =>
            completed.filter((row) => row.source === source).slice(0, 2),
          )
        : [],
    points: offset === 0 ? completed.map(occurrenceStats).reverse() : [],
    nextCursor: offset + 20 < rows.length ? `${offset + 20}:${binding}` : null,
  });
}
