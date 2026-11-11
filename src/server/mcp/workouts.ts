import 'server-only';
import { createHash } from 'node:crypto';
import type { McpWorkoutInput, McpExerciseHistoryInput } from '@/contracts/mcp';
import { readWorkoutDetails } from '@/server/workouts/details';
import {
  listSavedWorkouts,
  requireOwnerWorkoutRead,
} from '@/server/workouts/saved-read';
import { hasProviderSetData } from '@/server/workouts/execution-status';
import {
  localView,
  linkedView,
  nativeView,
  type HistoryWorkout,
  type SetData,
  type HistoryExercise,
  historyUnits as units,
} from '@/server/workouts/history-views';
export { exerciseHistoryRef } from '@/server/workouts/history-views';
import { McpReadError, pageRows, readOffset } from './pagination';

function recorded(set: SetData) {
  return set.metrics === undefined
    ? set.reps !== undefined
    : hasProviderSetData({ done: set.done ?? null, metrics: set.metrics });
}
function* exerciseRows(
  exercises: HistoryExercise[],
  detail: 'summary' | 'records',
  exerciseId?: number,
): Generator<Record<string, unknown>> {
  for (const e of exercises) {
    if (
      exerciseId !== undefined &&
      (e.phase !== 'actual' || e.historyRef?.exerciseId !== exerciseId)
    )
      continue;
    const identity = {
      name: e.name,
      exerciseId: e.exerciseId,
      comment: e.comment,
      fatigue: e.fatigue,
      failure: e.failure,
      occurrenceId: e.occurrenceId,
      phase: e.phase,
      historyRef: e.historyRef,
    };
    if (detail === 'summary') {
      let recordedSetCount = 0;
      for (const set of e.sets) {
        if (e.phase === 'actual' && recorded(set)) recordedSetCount++;
      }
      const setCount =
        exerciseId === undefined ? e.sets.length : recordedSetCount;
      if (exerciseId !== undefined && setCount === 0) continue;
      yield { ...identity, setCount, recordedSetCount };
    } else {
      for (const set of e.sets) {
        const isRecorded = e.phase === 'actual' && recorded(set);
        if (exerciseId !== undefined && !isRecorded) continue;
        yield { ...identity, ...set, recorded: isRecorded };
      }
    }
  }
}
function appendRow<T>(rows: T[], row: T) {
  if (rows.length >= 10000) throw new McpReadError('narrow_range');
  rows.push(row);
}
function paginate(
  ownerId: string,
  tool: string,
  input: McpWorkoutInput | McpExerciseHistoryInput,
  rows: unknown[],
) {
  const { cursor, limit, ...query } = input;
  const binding = createHash('sha256')
    .update(JSON.stringify([ownerId, tool, query]))
    .digest('hex');
  return pageRows(rows, readOffset(cursor, binding), limit, binding);
}
export async function readMcpWorkout(
  headers: Headers,
  ownerId: string,
  input: McpWorkoutInput,
) {
  await requireOwnerWorkoutRead(headers, ownerId);
  const ref = input.workoutRef;
  const resource =
    ref.kind === 'linked' ? { kind: 'link' as const, id: ref.id } : ref;
  const detail = await readWorkoutDetails(headers, ownerId, resource, ref.date);
  await requireOwnerWorkoutRead(headers, ownerId);
  if (!detail) throw new McpReadError('not_found');
  let workout: HistoryWorkout;
  if (detail.kind === 'native') workout = nativeView(detail.item);
  else if (detail.kind === 'link') workout = linkedView(detail.item);
  else {
    workout = localView(detail.workout);
    workout.related = detail.sync ? [linkedView(detail.sync).workoutRef] : [];
  }
  // Related references are page rows too; no unbounded arrays or silent truncation.
  const { exercises, related, ...metadata } = workout;
  const rows: Record<string, unknown>[] = [];
  for (const row of exerciseRows(exercises, input.detail)) {
    appendRow(rows, { recordType: 'exercise', ...row });
  }
  for (const workoutRef of related) {
    appendRow(rows, { recordType: 'related_workout', workoutRef });
  }
  const page = paginate(ownerId, 'get_workout', input, rows);
  await requireOwnerWorkoutRead(headers, ownerId);
  return {
    version: 1 as const,
    data: {
      ...metadata,
      units,
      coverage: {
        scope: 'locally_saved_records',
        upstreamCompleteness: 'unknown',
      },
      records: page.records,
    },
    next_cursor: page.next_cursor,
  };
}
export async function readMcpExerciseHistory(
  headers: Headers,
  ownerId: string,
  input: McpExerciseHistoryInput,
) {
  await requireOwnerWorkoutRead(headers, ownerId);
  const { local, linked, native } = await listSavedWorkouts(headers, ownerId, {
    from: input.from,
    to: input.to,
  });
  const views = [
    ...local.workouts.map(localView),
    ...linked.map(linkedView),
    ...native.map(nativeView),
  ].filter(
    (w) =>
      w.date >= input.from &&
      w.date <= input.to &&
      ['completed', 'in_progress'].includes(w.executionStatus),
  );
  const matching: {
    workout: HistoryWorkout;
    rows: Record<string, unknown>[];
  }[] = [];
  let rowCount = 0;
  for (const workout of views) {
    const rows: Record<string, unknown>[] = [];
    for (const row of exerciseRows(
      workout.exercises,
      input.detail,
      input.exerciseRef.exerciseId,
    )) {
      if (rowCount >= 10000) throw new McpReadError('narrow_range');
      rows.push(row);
      rowCount++;
    }
    if (rows.length > 0) matching.push({ workout, rows });
  }
  const key = (w: HistoryWorkout) =>
    w.workoutId ? JSON.stringify([w.workoutId, w.date]) : null;
  const localKeys = new Set(
    matching
      .filter((v) => v.workout.workoutRef.kind === 'workout')
      .map((v) => key(v.workout))
      .filter((k) => k != null),
  );
  const linkedKeys = new Set(
    matching
      .filter((v) => v.workout.workoutRef.kind === 'linked')
      .map((v) => key(v.workout))
      .filter((k) => k != null),
  );
  const overlap = (w: HistoryWorkout) => {
    const k = key(w);
    return k !== null && localKeys.has(k) && linkedKeys.has(k);
  };
  matching.sort(
    (a, b) =>
      a.workout.date.localeCompare(b.workout.date) ||
      JSON.stringify(a.workout.workoutRef).localeCompare(
        JSON.stringify(b.workout.workoutRef),
      ),
  );
  const rows = matching.flatMap(({ workout, rows }) =>
    rows.map((row) => ({
      workoutRef: workout.workoutRef,
      date: workout.date,
      source: workout.source,
      executionStatus: workout.executionStatus,
      freshness: workout.freshness,
      possibleOverlap: overlap(workout),
      ...row,
    })),
  );
  const page = paginate(ownerId, 'get_exercise_history', input, rows);
  await requireOwnerWorkoutRead(headers, ownerId);
  return {
    version: 1 as const,
    data: {
      range: { from: input.from, to: input.to },
      exerciseRef: input.exerciseRef,
      timezone: input.timezone,
      units,
      coverage: {
        scope: 'locally_saved_actual_sets',
        upstreamCompleteness: 'unknown',
        possibleOverlaps: matching.some((v) => overlap(v.workout)),
        identity: 'exact_provider_id_only',
        noRecordsMeans: 'no_saved_matching_facts',
      },
      records: page.records,
    },
    next_cursor: page.next_cursor,
  };
}
