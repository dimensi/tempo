import 'server-only';
import { createHash } from 'node:crypto';
import type {
  WorkoutExercise,
  WorkoutSession,
  PlannedWorkout,
} from '@/contracts/workouts';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import type { TransformMateNativeItem } from '@/contracts/transformmate-native';
import type {
  McpExerciseRef,
  McpWorkoutRef,
  McpWorkoutInput,
  McpExerciseHistoryInput,
  McpWorkoutExecutionStatus,
} from '@/contracts/mcp';
import { readWorkoutDetails } from '@/server/workouts/details';
import {
  listSavedWorkouts,
  requireOwnerWorkoutRead,
} from '@/server/workouts/saved-read';
import {
  hasProviderSetData,
  providerExecutionStatus,
} from './workout-execution';
import { McpReadError, pageRows, readOffset } from './pagination';

export function exerciseHistoryRef(
  exerciseId: number | undefined,
): McpExerciseRef | null {
  return exerciseId === undefined
    ? null
    : { source: 'TransformMate', exerciseId };
}
type Metric = { name: string; unit: string; type: string; values: string[] };
type SetData = {
  order: number;
  reps?: number;
  weightKg?: number | null;
  done?: boolean | null;
  metrics?: Metric[];
};
type Exercise = {
  name: string;
  occurrenceId: string;
  phase: 'plan' | 'actual';
  historyRef: McpExerciseRef | null;
  sets: SetData[];
};
type Workout = {
  workoutRef: McpWorkoutRef;
  source: 'LOCAL' | 'TransformMate';
  date: string;
  title: string;
  executionStatus: McpWorkoutExecutionStatus;
  planId?: string | null;
  workoutId?: string | null;
  planBasis?: 'saved_plan' | 'session_snapshot' | 'published_snapshot';
  freshness: {
    lastSavedAt: string | null;
    lastFetchedAt: string | null;
    lastCheckedAt: string | null;
  };
  exercises: Exercise[];
  related: McpWorkoutRef[];
};
const units = {
  weight: 'kg',
  reps: 'repetitions',
  providerMetrics: 'per_metric_unit',
};
function localExercises(
  exercises: WorkoutExercise[],
  phase: Exercise['phase'],
): Exercise[] {
  return exercises.map((e, index) => ({
    name: e.name,
    occurrenceId: `${phase}:${e.id ?? e.transformMate?.occurrenceKey ?? index + 1}`,
    phase,
    historyRef: exerciseHistoryRef(e.transformMate?.exerciseId),
    sets: e.sets.map((s, order) => ({
      order: order + 1,
      reps: s.reps,
      weightKg: s.weightKg,
    })),
  }));
}
function planView(
  planId: string,
  workout: PlannedWorkout,
  updatedAt: string | null,
): Workout {
  return {
    workoutRef: {
      kind: 'plan',
      planId,
      workoutId: workout.id,
      date: workout.date,
    },
    source: 'LOCAL',
    date: workout.date,
    title: workout.title,
    executionStatus: 'planned',
    planId,
    workoutId: workout.id,
    planBasis: 'saved_plan',
    freshness: {
      lastSavedAt: updatedAt,
      lastFetchedAt: null,
      lastCheckedAt: null,
    },
    exercises: localExercises(workout.exercises, 'plan'),
    related: [],
  };
}
function sessionView(session: WorkoutSession): Workout {
  return {
    workoutRef: { kind: 'session', id: session.id, date: session.date },
    source: 'LOCAL',
    date: session.date,
    title: session.title,
    executionStatus: session.status,
    planId: session.planId,
    workoutId: session.plannedWorkoutId,
    planBasis: session.planSnapshot ? 'session_snapshot' : undefined,
    freshness: {
      lastSavedAt: session.updatedAt,
      lastFetchedAt: null,
      lastCheckedAt: null,
    },
    exercises: [
      ...localExercises(session.planSnapshot?.workout.exercises ?? [], 'plan'),
      ...localExercises(session.exercises, 'actual'),
    ],
    related:
      session.planId && session.plannedWorkoutId
        ? [
            {
              kind: 'plan',
              planId: session.planId,
              workoutId: session.plannedWorkoutId,
              date: session.planSnapshot?.workout.date ?? session.date,
            },
          ]
        : [],
  };
}
function linkedView(item: TransformMateSyncItem): Workout {
  const actual = item.actual;
  const plan = (item.publishedSnapshot ?? item.planSnapshot).workout;
  const date = actual?.date ?? item.planSnapshot.workout.date;
  return {
    workoutRef: { kind: 'linked', id: item.id, date },
    source: 'TransformMate',
    date,
    title: actual?.title ?? plan.title,
    planId: item.planId,
    workoutId: item.workoutId,
    executionStatus: providerExecutionStatus(
      actual,
      actual?.exercises.flatMap((e) => e.sets) ?? [],
    ),
    planBasis: item.publishedSnapshot ? 'published_snapshot' : 'saved_plan',
    freshness: {
      lastSavedAt: null,
      lastFetchedAt: null,
      lastCheckedAt:
        [item.checkedAt, item.updateAttempt?.checkedAt]
          .filter((v): v is string => v != null)
          .sort((a, b) => Date.parse(a) - Date.parse(b))
          .at(-1) ?? null,
    },
    exercises: [
      ...localExercises(plan.exercises, 'plan'),
      ...(actual?.exercises.map((e, index) => ({
        name: e.name,
        occurrenceId: `actual:${e.occurrenceKey ?? index + 1}`,
        phase: 'actual' as const,
        historyRef: exerciseHistoryRef(e.exerciseId),
        sets: e.sets,
      })) ?? []),
    ],
    related: [
      {
        kind: 'plan',
        planId: item.planId,
        workoutId: item.workoutId,
        date: item.planSnapshot.workout.date,
      },
    ],
  };
}
function nativeView(item: TransformMateNativeItem): Workout {
  return {
    workoutRef: { kind: 'native', id: item.remoteTrainingId, date: item.date },
    source: 'TransformMate',
    date: item.date,
    title: item.title,
    executionStatus: providerExecutionStatus(
      item,
      item.exercises.flatMap((e) =>
        e.metrics.filter((m) => m.type === 'fact').flatMap((m) => m.sets),
      ),
    ),
    freshness: {
      lastSavedAt: null,
      lastFetchedAt: item.fetchedAt,
      lastCheckedAt: null,
    },
    exercises: item.exercises.flatMap((e) =>
      e.metrics.map((group, groupIndex) => ({
        name: e.name,
        occurrenceId: `${group.type}:${e.protocolId}:${e.remoteExerciseId}:${groupIndex}`,
        phase: group.type === 'plan' ? ('plan' as const) : ('actual' as const),
        historyRef: exerciseHistoryRef(e.exerciseId),
        sets: group.sets,
      })),
    ),
    related: [],
  };
}
function recorded(set: SetData) {
  return set.metrics === undefined
    ? set.reps !== undefined
    : hasProviderSetData({ done: set.done ?? null, metrics: set.metrics });
}
function* exerciseRows(
  exercises: Exercise[],
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
  let workout: Workout;
  if (detail.kind === 'native') workout = nativeView(detail.item);
  else if (detail.kind === 'session') workout = sessionView(detail.session);
  else if (detail.kind === 'link') workout = linkedView(detail.item);
  else {
    workout = planView(detail.plan.id, detail.workout, detail.plan.updatedAt);
    workout.related = [
      ...detail.sessions.map((s) => ({
        kind: 'session' as const,
        id: s.id,
        date: s.date,
      })),
      ...(detail.sync ? [linkedView(detail.sync).workoutRef] : []),
    ];
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
  const { local, linked, native } = await listSavedWorkouts(headers, ownerId, {
    from: input.from,
    to: input.to,
  });
  const views = [
    ...local.sessions.map(sessionView),
    ...linked.map(linkedView),
    ...native.map(nativeView),
  ].filter(
    (w) =>
      w.date >= input.from &&
      w.date <= input.to &&
      ['completed', 'in_progress'].includes(w.executionStatus),
  );
  const matching: { workout: Workout; rows: Record<string, unknown>[] }[] = [];
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
  const key = (w: Workout) =>
    w.planId && w.workoutId
      ? JSON.stringify([w.planId, w.workoutId, w.date])
      : null;
  const localKeys = new Set(
    matching
      .filter((v) => v.workout.workoutRef.kind === 'session')
      .map((v) => key(v.workout))
      .filter((k) => k != null),
  );
  const linkedKeys = new Set(
    matching
      .filter((v) => v.workout.workoutRef.kind === 'linked')
      .map((v) => key(v.workout))
      .filter((k) => k != null),
  );
  const overlap = (w: Workout) => {
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
