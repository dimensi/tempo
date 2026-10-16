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
});
