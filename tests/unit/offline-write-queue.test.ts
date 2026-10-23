import { expect, test } from 'vitest';
import {
  drainWrites,
  emptyWriteState,
  enqueueWrite,
  nextWrite,
  type WriteState,
  type WriteStore,
} from '@/lib/offline-write-queue';
import type { WritePayload } from '@/contracts/offline-write';
import { migrateWorkoutWrites } from '@/lib/workout-write-migration';

const partition = 'a'.repeat(43);
const payload: WritePayload = {
  kind: 'measurement',
  data: {
    measuredAt: '2026-09-01',
    note: null,
    values: [{ metric: 'weight', value: '75', unit: 'kg' }],
  },
};

test('replays one accepted offline write without crossing into another account', async () => {
  let state: WriteState = { ...emptyWriteState(), partition };
  const store: WriteStore = {
    async update(action) {
      const draft = structuredClone(state);
      const result = action(draft);
      state = draft;
      return result;
    },
  };
  await store.update((draft) => enqueueWrite(draft, partition, payload));

  const accepted = new Set<string>();
  const sent: string[] = [];
  let loseResponse = true;
  let now = 0;
  await drainWrites(
    store,
    partition,
    async (operation) => {
      sent.push(operation.id);
      accepted.add(operation.id);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('Synthetic lost response');
      }
      return {
        status: 200,
        record: { id: operation.recordId, version: '1', payload },
      };
    },
    () => now,
  );
  now = 10000;
  await drainWrites(
    store,
    partition,
    async (operation) => ({
      status: 200,
      record: { id: operation.recordId, version: '1', payload },
    }),
    () => now,
  );

  expect(accepted.size).toBe(1);
  expect(sent).toHaveLength(1);
  expect(state.operations[0]?.status).toBe('synced');
  expect(nextWrite(state, 'b'.repeat(43), now)).toBeUndefined();

  const originalId = crypto.randomUUID();
  const legacy = {
    partition,
    yazioEpoch: null,
    records: [],
    operations: [
      {
        operation: {
          id: originalId,
          recordId: crypto.randomUUID(),
          partition,
          yazioEpoch: null,
          base: null,
          payload: {
            kind: 'workout',
            data: {
              date: '2026-10-15',
              title: 'Gym',
              note: 'entered',
              status: 'completed',
              exercises: [
                {
                  id: crypto.randomUUID(),
                  name: 'Squat',
                  sets: [{ reps: 8, weightKg: 55 }],
                },
              ],
            },
          },
        },
        status: 'local',
        attempts: 0,
        nextAttempt: 0,
      },
    ],
  } as WriteState;
  const linked = structuredClone(legacy);
  const linkedPayload = linked.operations[0]!.operation.payload;
  if (linkedPayload.kind !== 'workout') throw new Error('Expected workout');
  Object.assign(linkedPayload.data, {
    planId: 'old-plan',
    plannedWorkoutId: 'old-workout',
  });
  const linkedReview = migrateWorkoutWrites(linked);
  expect(linkedReview.operations).toHaveLength(1);
  expect(linkedReview.operations[0]).toMatchObject({
    status: 'review',
    reason: 'conflict',
    legacyOperation: {
      payload: {
        data: { planId: 'old-plan', plannedWorkoutId: 'old-workout' },
      },
    },
  });
  expect(nextWrite(linkedReview, partition, now)).toBeUndefined();
  expect(migrateWorkoutWrites(linkedReview).operations).toHaveLength(1);
  const migrated = migrateWorkoutWrites(legacy);
  expect(
    migrated.operations.map(
      (item) =>
        item.operation.payload.kind === 'workout' &&
        item.operation.payload.data.status,
    ),
  ).toEqual(['planned', 'in_progress', 'completed']);
  expect(migrated.operations[2]?.operation.id).toBe(originalId);
  expect(migrateWorkoutWrites(migrated).operations).toHaveLength(3);
  const uncertain = structuredClone(legacy);
  delete uncertain.workoutVersion;
  uncertain.operations = [
    {
      ...structuredClone(migrated.operations[2]!),
      status: 'sending',
      attempts: 1,
    },
  ];
  const reviewed = migrateWorkoutWrites(uncertain);
  expect(reviewed.operations[0]?.legacyOperation).toBeDefined();
  expect(reviewed.operations[0]?.operation.id).toBe(originalId);
  expect(reviewed.operations[0]?.status).toBe('review');
  expect(nextWrite(reviewed, partition, now)).toBeUndefined();
});
