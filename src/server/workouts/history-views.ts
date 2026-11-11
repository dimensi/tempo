import 'server-only';
import type {
  WorkoutExercise,
  Workout as LocalWorkout,
} from '@/contracts/workouts';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import type { TransformMateNativeItem } from '@/contracts/transformmate-native';
import type {
  McpExerciseRef,
  McpWorkoutRef,
  McpWorkoutExecutionStatus,
} from '@/contracts/mcp';
import { providerExecutionStatus } from './execution-status';

export function exerciseHistoryRef(
  exerciseId: number | undefined,
): McpExerciseRef | null {
  return exerciseId === undefined
    ? null
    : { source: 'TransformMate', exerciseId };
}
type Metric = {
  key?: string;
  name: string;
  unit: string;
  type: string;
  values: string[];
};
export type SetData = {
  order: number;
  reps?: number;
  weightKg?: number | null;
  done?: boolean | null;
  metrics?: Metric[];
};
export type HistoryExercise = {
  name: string;
  exerciseId?: string;
  comment?: string;
  fatigue?: number | null;
  failure?: string | null;
  occurrenceId: string;
  phase: 'plan' | 'actual';
  historyRef: McpExerciseRef | null;
  sets: SetData[];
};
export type HistoryWorkout = {
  workoutRef: McpWorkoutRef;
  source: 'LOCAL' | 'TransformMate';
  date: string;
  title: string;
  executionStatus: McpWorkoutExecutionStatus;
  workoutId?: string;
  revision?: number;
  note?: string;
  editable?: boolean;
  planBasis?: 'saved_plan' | 'published_snapshot';
  freshness: {
    lastSavedAt: string | null;
    lastFetchedAt: string | null;
    lastCheckedAt: string | null;
  };
  exercises: HistoryExercise[];
  related: McpWorkoutRef[];
};
export const historyUnits = {
  weight: 'kg',
  reps: 'repetitions',
  providerMetrics: 'per_metric_unit',
};
function localExercises(
  exercises: WorkoutExercise[],
  phase: HistoryExercise['phase'],
): HistoryExercise[] {
  return exercises.map((e, index) => ({
    name: e.name,
    exerciseId: e.id,
    comment: e.comment,
    fatigue: e.fatigue ?? null,
    failure: e.failure ?? null,
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
export function localView(workout: LocalWorkout): HistoryWorkout {
  return {
    workoutRef: { kind: 'workout', id: workout.id, date: workout.date },
    source: 'LOCAL',
    date: workout.date,
    title: workout.title,
    executionStatus: workout.status,
    workoutId: workout.id,
    revision: workout.revision,
    note: workout.note,
    editable: true,
    freshness: {
      lastSavedAt: workout.updatedAt,
      lastFetchedAt: null,
      lastCheckedAt: null,
    },
    exercises: localExercises(
      workout.exercises,
      workout.status === 'planned' ? 'plan' : 'actual',
    ),
    related: [],
  };
}
export function linkedView(item: TransformMateSyncItem): HistoryWorkout {
  const actual = item.actual;
  const plan = (item.publishedSnapshot ?? item.planSnapshot).workout;
  const date = actual?.date ?? item.planSnapshot.workout.date;
  return {
    workoutRef: { kind: 'linked', id: item.id, date },
    source: 'TransformMate',
    editable: false,
    date,
    title: actual?.title ?? plan.title,
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
        comment: e.comment,
        occurrenceId: `actual:${e.occurrenceKey ?? index + 1}`,
        phase: 'actual' as const,
        historyRef: exerciseHistoryRef(e.exerciseId),
        sets: e.sets,
      })) ?? []),
    ],
    related: [
      {
        kind: 'workout',
        id: item.workoutId,
        date: item.planSnapshot.workout.date,
      },
    ],
  };
}
export function nativeView(item: TransformMateNativeItem): HistoryWorkout {
  return {
    workoutRef: { kind: 'native', id: item.remoteTrainingId, date: item.date },
    source: 'TransformMate',
    editable: false,
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
        comment: e.comment,
        occurrenceId: `${group.type}:${e.protocolId}:${e.remoteExerciseId}:${groupIndex}`,
        phase: group.type === 'plan' ? ('plan' as const) : ('actual' as const),
        historyRef: exerciseHistoryRef(e.exerciseId),
        sets: group.sets,
      })),
    ),
    related: [],
  };
}
