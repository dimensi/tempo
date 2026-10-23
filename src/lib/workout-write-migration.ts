import { workoutInputSchema, type WorkoutInput } from '@/contracts/workouts';
import type { WritePayload, WriteRecord } from '@/contracts/offline-write';
import type { WriteState, QueuedWrite } from './offline-write-queue';

/** One-time conversion of pre-lifecycle data. Sent commands are never silently retried as different commands. */
export function migrateWorkoutWrites(state: WriteState): WriteState {
  if (state.workoutVersion === 2) return state;
  const normalize = (payload: WritePayload): WritePayload => {
    if (payload.kind !== 'workout') return payload;
    const old = payload.data as WorkoutInput & { status: string };
    const skipped = String(old.status) === 'skipped';
    return {
      kind: 'workout',
      data: workoutInputSchema.parse({
        date: old.date,
        title: old.title,
        note: skipped ? `${old.note}\nБыла пропущена`.trim() : old.note,
        status: skipped ? 'planned' : old.status,
        exercises: old.exercises,
      }),
    };
  };
  const record = (value: WriteRecord): WriteRecord => ({
    ...value,
    payload: normalize(value.payload),
  });
  state.records = state.records.map(record);
  const migrated: QueuedWrite[] = [];
  for (const item of state.operations) {
    if (item.operation.payload.kind !== 'workout') {
      migrated.push(item);
      continue;
    }
    const original = structuredClone(item.operation);
    const payload = normalize(item.operation.payload);
    if (payload.kind !== 'workout')
      throw new Error('Invalid workout migration');
    item.operation = { ...item.operation, payload };
    if (item.result) item.result = record(item.result);
    if (item.status === 'synced') {
      migrated.push(item);
      continue;
    }
    const oldData = original.payload.data as unknown as Record<string, unknown>;
    const linked = oldData.planId != null || oldData.plannedWorkoutId != null;
    if (linked || item.attempts > 0 || item.operation.base !== null) {
      // A linked session may map to a different migrated workout ID. Preserve its identity
      // for review; sent commands may also have an accepted old fingerprint.
      item.legacyOperation = original;
      item.status = 'review';
      item.reason = 'conflict';
      migrated.push(item);
      continue;
    }
    const finalStatus = payload.data.status;
    if (finalStatus === 'planned') {
      migrated.push(item);
      continue;
    }
    const intermediate = (
      status: WorkoutInput['status'],
      action?: 'start',
    ) => ({
      ...structuredClone(item),
      operation: {
        ...item.operation,
        id: crypto.randomUUID(),
        base: action ? '' : null,
        payload: {
          kind: 'workout' as const,
          data: { ...payload.data, status },
          ...(action ? { action } : {}),
        },
      },
      status: 'local' as const,
      attempts: 0,
      nextAttempt: 0,
    });
    migrated.push(intermediate('planned'));
    if (finalStatus === 'completed')
      migrated.push(intermediate('in_progress', 'start'));
    item.operation.base = '';
    item.operation.payload = {
      ...payload,
      action: finalStatus === 'completed' ? 'complete' : 'start',
    };
    migrated.push(item);
  }
  state.operations = migrated;
  state.workoutVersion = 2;
  return state;
}
