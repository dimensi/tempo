import { describe, expect, it } from 'vitest';
import {
  emptyWriteState,
  enqueueWrite,
  mergeWriteCatalog,
  pruneSettledWrites,
  nextWrite,
  settleWrite,
  resolveWrite,
  drainWrites,
  pendingWrites,
  type WriteState,
  type WriteStore,
} from '@/lib/offline-write-queue';
import type { WritePayload, WriteRecord } from '@/contracts/offline-write';
const partition = 'a'.repeat(43);
const payload: WritePayload = {
  kind: 'measurement',
  data: {
    measuredAt: '2026-09-01',
    note: null,
    values: [{ metric: 'weight', value: '75', unit: 'kg' }],
  },
};
function memory() {
  let state: WriteState = { ...emptyWriteState(), partition };
  const store: WriteStore = {
    async update(action) {
      const draft = structuredClone(state);
      const result = action(draft);
      state = draft;
      return result;
    },
  };
  return { store, read: () => state };
}
const record = (id: string, version = '1'): WriteRecord => ({
  id,
  version,
  payload,
});
describe('durable write state transitions', () => {
  it('commits the visible result with its operation, and keeps both absent on abort/quota', async () => {
    const { store, read } = memory();
    await expect(
      store.update((state) => {
        enqueueWrite(state, partition, payload);
        throw new Error('QuotaExceededError');
      }),
    ).rejects.toThrow('QuotaExceededError');
    expect(read().records).toEqual([]);
    expect(read().operations).toEqual([]);
    await store.update((state) => enqueueWrite(state, partition, payload));
    expect(read().records).toHaveLength(1);
    expect(pendingWrites(read())).toHaveLength(1);
  });
  it('replays the same immutable operation after an accepted write loses its response', async () => {
    const { store, read } = memory();
    await store.update((state) => enqueueWrite(state, partition, payload));
    const accepted = new Map<string, WriteRecord>();
    const sent: string[] = [];
    let lost = true,
      now = 100;
    const send = async (
      operation: import('@/contracts/offline-write').OfflineWrite,
    ) => {
      sent.push(JSON.stringify(operation));
      if (!accepted.has(operation.id))
        accepted.set(operation.id, record(operation.recordId));
      if (lost) {
        lost = false;
        throw new Error('lost response');
      }
      return { status: 200, record: accepted.get(operation.id)! };
    };
    await drainWrites(store, partition, send, () => now);
    expect(accepted.size).toBe(1);
    expect(read().operations[0]!.status).toBe('local');
    await drainWrites(store, partition, send, () => now);
    expect(sent).toHaveLength(1);
    now = 10000;
    await drainWrites(store, partition, send, () => now);
    expect(sent[0]).toEqual(sent[1]);
    expect(accepted.size).toBe(1);
    expect(read().operations[0]!.status).toBe('synced');
  });
  it('recovers sending state after a normal application restart with the original operation ID', async () => {
    const { store, read } = memory();
    const op = await store.update((state) => {
      const op = enqueueWrite(state, partition, payload);
      state.operations[0]!.status = 'sending';
      state.operations[0]!.attempts = 1;
      return op;
    });
    const restored = structuredClone(read());
    const restarted: WriteStore = {
      async update(action) {
        return action(restored);
      },
    };
    const ids: string[] = [];
    await drainWrites(restarted, partition, async (operation) => {
      ids.push(operation.id);
      return { status: 200, record: record(operation.recordId) };
    });
    expect(ids).toEqual([op.id]);
    expect(restored.operations[0]!.status).toBe('synced');
  });
  it('bounds retries and delays transport and server failures', async () => {
    const { store, read } = memory();
    await store.update((state) => enqueueWrite(state, partition, payload));
    let now = 0,
      calls = 0;
    const send = async () => {
      calls++;
      return { status: 503 };
    };
    for (let n = 0; n < 8; n++) {
      await drainWrites(store, partition, send, () => now);
      now += 1000000;
    }
    expect(calls).toBe(5);
    expect(read().operations[0]!.status).toBe('review');
  });
  it.each([400, 401, 403, 404, 409, 413, 422])(
    'stops automatic retries for status %i without losing the local payload',
    async (status) => {
      const { store, read } = memory();
      await store.update((state) => enqueueWrite(state, partition, payload));
      let calls = 0;
      for (let n = 0; n < 3; n++)
        await drainWrites(
          store,
          partition,
          async () => {
            calls++;
            return { status };
          },
          () => 1000000 * n,
        );
      expect(calls).toBe(1);
      expect(read().operations[0]!.status).toBe('review');
      expect(read().records[0]!.payload).toEqual(payload);
    },
  );
  it('orders dependent operations, fixes the next base only before first send, and permits independent work', async () => {
    const { store, read } = memory();
    const first = await store.update((state) =>
      enqueueWrite(state, partition, payload),
    );
    const second = await store.update((state) =>
      enqueueWrite(
        state,
        partition,
        { ...payload, data: { ...payload.data, note: 'edited' } },
        first.recordId,
      ),
    );
    const independent = await store.update((state) =>
      enqueueWrite(state, partition, payload),
    );
    await store.update((state) => {
      state.operations[0]!.status = 'review';
    });
    expect(nextWrite(read(), partition, 0)?.operation.id).toBe(independent.id);
    await store.update((state) => {
      state.operations[0]!.status = 'local';
    });
    const sent: { id: string; base: string | null }[] = [];
    await drainWrites(store, partition, async (operation) => {
      sent.push({ id: operation.id, base: operation.base });
      return {
        status: 200,
        record: record(
          operation.recordId,
          operation.id === first.id ? 'v1' : 'v2',
        ),
      };
    });
    expect(sent.slice(0, 2)).toEqual([
      { id: first.id, base: null },
      { id: second.id, base: 'v1' },
    ]);
  });
  it('keeps the edit baseline when another device refreshes the same record during editing', async () => {
    const { store, read } = memory();
    const id = crypto.randomUUID();
    await store.update((state) => {
      state.records = [record(id, 'v2')];
      enqueueWrite(state, partition, payload, id, undefined, 'v1');
    });
    expect(read().operations[0]!.operation.base).toBe('v1');
    await store.update((state) =>
      settleWrite(state, state.operations[0]!.operation.id, { status: 409 }, 0),
    );
    await store.update((state) =>
      mergeWriteCatalog(state, {
        partition,
        yazioEpoch: null,
        records: [record(id, 'v3')],
      }),
    );
    expect(read().records[0]!.payload).toEqual(payload);
    expect(read().operations[0]!.status).toBe('review');
  });
  it('does not publish or send pending records for another account', async () => {
    const { store, read } = memory();
    await store.update((state) => enqueueWrite(state, partition, payload));
    const other = 'b'.repeat(43);
    let calls = 0;
    await drainWrites(store, other, async () => {
      calls++;
      return { status: 200 };
    });
    expect(calls).toBe(0);
    expect(nextWrite(read(), other, Date.now())).toBeUndefined();
    expect(() =>
      mergeWriteCatalog(read(), {
        partition: other,
        yazioEpoch: null,
        records: [],
      }),
    ).toThrow('Account changed');
    expect(() => enqueueWrite(read(), other, payload)).toThrow(
      'Account changed',
    );
  });
  it('cache retention removes old acknowledged measurements but preserves pending and review variants', async () => {
    const { store, read } = memory();
    await store.update((state) => {
      const pending = enqueueWrite(state, partition, payload);
      const synced = enqueueWrite(state, partition, payload);
      const review = enqueueWrite(state, partition, payload);
      settleWrite(
        state,
        synced.id,
        { status: 200, record: record(synced.recordId) },
        0,
      );
      settleWrite(state, review.id, { status: 409 }, 0);
      pruneSettledWrites(state, '2026-10-01');
      expect(state.records.map((item) => item.id)).toEqual([
        pending.recordId,
        review.recordId,
      ]);
    });
    expect(pendingWrites(read())).toHaveLength(2);
  });
  it('rechecks an uncertain result with its original operation and record IDs instead of cloning it', async () => {
    const { store, read } = memory();
    const operation = await store.update((state) =>
      enqueueWrite(state, partition, payload),
    );
    await store.update((state) => {
      state.operations[0]!.attempts = 5;
      settleWrite(state, operation.id, { status: 0 }, 0);
    });
    await expect(
      store.update((state) =>
        resolveWrite(state, partition, operation.recordId, false),
      ),
    ).rejects.toThrow('Uncertain result');
    await store.update((state) =>
      resolveWrite(state, partition, operation.recordId, true),
    );
    expect(read().operations).toHaveLength(1);
    expect(read().operations[0]!.operation).toEqual(operation);
    expect(read().operations[0]!.status).toBe('local');
  });
  it('resolves an explicit version conflict by preserving a separate local copy only after user choice', async () => {
    const { store, read } = memory();
    const operation = await store.update((state) =>
      enqueueWrite(state, partition, payload),
    );
    await store.update((state) =>
      settleWrite(state, operation.id, { status: 409 }, 0),
    );
    await store.update((state) =>
      resolveWrite(state, partition, operation.recordId, true),
    );
    expect(read().records).toHaveLength(1);
    expect(read().records[0]!.id).not.toBe(operation.recordId);
    expect(read().records[0]!.payload).toEqual(payload);
    expect(read().operations[0]!.operation.base).toBeNull();
  });
  it('detaches a conflicted plan when the user explicitly saves a separate local workout', async () => {
    const { store, read } = memory();
    const operation = await store.update((state) =>
      enqueueWrite(state, partition, {
        kind: 'workout',
        planRevision: 1,
        data: {
          date: '2026-10-15',
          title: '',
          note: '',
          status: 'in_progress',
          exercises: [],
          planId: crypto.randomUUID(),
          plannedWorkoutId: crypto.randomUUID(),
        },
      }),
    );
    await store.update((state) => {
      settleWrite(state, operation.id, { status: 409 }, 0);
      resolveWrite(state, partition, operation.recordId, true);
    });
    expect(read().operations[0]!.operation.payload).not.toHaveProperty(
      'planRevision',
    );
    expect(read().operations[0]!.operation.payload.data).not.toHaveProperty(
      'planId',
    );
  });
});
