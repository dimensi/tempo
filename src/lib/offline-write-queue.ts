import {
  offlineWriteSchema,
  type OfflineWrite,
  type WritePayload,
  type WriteRecord,
  type WriteStatus,
  type WriteCatalog,
} from '@/contracts/offline-write';
import { migrateWorkoutWrites } from './workout-write-migration';
export interface QueuedWrite {
  operation: OfflineWrite;
  status: WriteStatus;
  attempts: number;
  nextAttempt: number;
  reason?: 'conflict' | 'access' | 'validation' | 'retry';
  result?: WriteRecord;
  legacyOperation?: unknown;
}
export interface WriteState {
  workoutVersion?: 2;
  partition: string | null;
  yazioEpoch: number | null;
  records: WriteRecord[];
  operations: QueuedWrite[];
}
export const emptyWriteState = (): WriteState => ({
  workoutVersion: 2,
  partition: null,
  yazioEpoch: null,
  records: [],
  operations: [],
});
export function pendingWrites(state: WriteState) {
  return state.operations.filter((item) => item.status !== 'synced');
}
export function enqueueWrite(
  state: WriteState,
  partition: string,
  payload: WritePayload,
  recordId = crypto.randomUUID(),
  operationId = crypto.randomUUID(),
  expectedBase?: string,
) {
  if (state.partition !== partition) throw new Error('Account changed');
  if (state.operations.length >= 1000) {
    const recent = new Set(
      state.operations
        .filter((item) => item.status === 'synced')
        .slice(-100)
        .map((item) => item.operation.id),
    );
    state.operations = state.operations.filter(
      (item) => item.status !== 'synced' || recent.has(item.operation.id),
    );
  }
  if (state.operations.length >= 1000) throw new Error('Storage limit');
  const previous = state.records.find((record) => record.id === recordId);
  const operation = offlineWriteSchema.parse({
    id: operationId,
    recordId,
    partition,
    yazioEpoch: state.yazioEpoch,
    base: expectedBase ?? previous?.version ?? null,
    payload,
  });
  // Never modify a sent operation. Every local save is a durable, ordered operation.
  state.operations.push({
    operation,
    status: 'local',
    attempts: 0,
    nextAttempt: 0,
  });
  state.records = [
    ...state.records.filter((record) => record.id !== recordId),
    { id: recordId, version: previous?.version ?? '', payload },
  ];
  return operation;
}
export function mergeWriteCatalog(state: WriteState, catalog: WriteCatalog) {
  if (state.partition !== catalog.partition) {
    // A new account gets no access to the old account's records or pending writes.
    // Activation is refused until explicit deletion or login as the original owner.
    if (pendingWrites(state).length) throw new Error('Account changed');
    Object.assign(state, emptyWriteState(), { partition: catalog.partition });
  }
  state.yazioEpoch = catalog.yazioEpoch;
  const pending = new Set(
    pendingWrites(state).map((item) => item.operation.recordId),
  );
  state.records = [
    ...catalog.records.filter((record) => !pending.has(record.id)),
    ...state.records.filter((record) => pending.has(record.id)),
  ];
}
export function pruneSettledWrites(state: WriteState, from: string) {
  const pending = new Set(
    pendingWrites(state).map((item) => item.operation.recordId),
  );
  const expired = new Set(
    state.records
      .filter(
        (record) =>
          record.payload.kind === 'measurement' &&
          record.payload.data.measuredAt < from &&
          !pending.has(record.id),
      )
      .map((record) => record.id),
  );
  state.records = state.records.filter((record) => !expired.has(record.id));
  state.operations = state.operations.filter(
    (item) => !expired.has(item.operation.recordId),
  );
}
export function nextWrite(state: WriteState, partition: string, now: number) {
  if (state.partition !== partition) return undefined;
  return state.operations.find(
    (item, index, items) =>
      item.operation.partition === partition &&
      (item.status === 'local' || item.status === 'sending') &&
      item.nextAttempt <= now &&
      !items
        .slice(0, index)
        .some(
          (previous) =>
            previous.operation.recordId === item.operation.recordId &&
            previous.status !== 'synced',
        ),
  );
}
export function settleWrite(
  state: WriteState,
  id: string,
  response: { status: number; record?: WriteRecord },
  now: number,
) {
  const item = state.operations.find((entry) => entry.operation.id === id);
  if (!item) throw new Error('Missing operation');
  if (response.status === 200 && response.record) {
    item.status = 'synced';
    item.result = response.record;
    const dependent = state.operations.find(
      (entry) =>
        entry.operation.recordId === item.operation.recordId &&
        entry.status !== 'synced',
    );
    // The dependent payload is immutable; its base is fixed only before its first send.
    if (dependent && dependent.attempts === 0)
      dependent.operation.base = response.record.version;
    if (!dependent)
      state.records = [
        ...state.records.filter((record) => record.id !== response.record!.id),
        response.record,
      ];
    return;
  }
  if (
    [400, 401, 403, 404, 409, 413, 422].includes(response.status) ||
    item.attempts >= 5
  ) {
    item.status = 'review';
    item.reason =
      response.status === 409
        ? 'conflict'
        : [401, 403].includes(response.status)
          ? 'access'
          : item.attempts >= 5
            ? 'retry'
            : 'validation';
  } else {
    item.status = 'local';
    item.nextAttempt =
      now + Math.min(300000, 2000 * 2 ** Math.min(item.attempts, 8));
  }
}
export function resolveWrite(
  state: WriteState,
  partition: string,
  recordId: string,
  keepLocal: boolean,
  serverRecord?: WriteRecord,
) {
  if (state.partition !== partition) throw new Error('Account changed');
  const related = state.operations.filter(
    (item) => item.operation.recordId === recordId && item.status !== 'synced',
  );
  if (
    related.some(
      (item) => item.status === 'review' && item.reason !== 'conflict',
    )
  ) {
    // An unacknowledged write may already exist on the server: only replay its stable ID.
    if (keepLocal)
      for (const item of related) {
        if (item.status === 'review') {
          item.status = 'local';
          item.attempts = 0;
          item.nextAttempt = 0;
        }
      }
    else throw new Error('Uncertain result');
    return;
  }
  // Explicitly reapply only feedback on the latest server workout; never copy or
  // overwrite somebody else's sets just to resolve an assessment conflict.
  if (
    keepLocal &&
    related.length &&
    related.every(
      (item) =>
        item.operation.payload.kind === 'workout' &&
        item.operation.payload.feedback,
    )
  ) {
    if (
      !serverRecord ||
      serverRecord.id !== recordId ||
      serverRecord.payload.kind !== 'workout' ||
      serverRecord.payload.data.status === 'planned'
    )
      throw new Error('Workout unavailable');
    let data = serverRecord.payload.data;
    for (const item of related) {
      const payload = item.operation.payload;
      if (
        payload.kind !== 'workout' ||
        !payload.feedback ||
        !data.exercises.some(
          (exercise) => exercise.id === payload.feedback!.exerciseId,
        )
      )
        throw new Error('Exercise unavailable');
    }
    state.operations = state.operations.filter(
      (item) => !related.includes(item),
    );
    state.records = [
      ...state.records.filter((item) => item.id !== recordId),
      serverRecord,
    ];
    for (const item of related) {
      const payload = item.operation.payload;
      if (payload.kind !== 'workout' || !payload.feedback) continue;
      const feedback = payload.feedback;
      data = {
        ...data,
        exercises: data.exercises.map((exercise) =>
          exercise.id === feedback.exerciseId
            ? {
                ...exercise,
                fatigue: feedback.fatigue,
                failure: feedback.failure,
              }
            : exercise,
        ),
      };
      enqueueWrite(
        state,
        partition,
        { kind: 'workout', data, feedback },
        recordId,
        undefined,
        serverRecord.version,
      );
    }
    return;
  }
  const record = state.records.find((item) => item.id === recordId);
  state.operations = state.operations.filter(
    (item) => item.operation.recordId !== recordId,
  );
  state.records = state.records.filter((item) => item.id !== recordId);
  // Conflict resolution keeps the local alternative as an explicit new record.
  if (keepLocal && record) {
    const payload: WritePayload =
      record.payload.kind === 'workout'
        ? {
            kind: 'workout',
            data: {
              date: record.payload.data.date,
              title: record.payload.data.title,
              exercises: record.payload.data.exercises.map((exercise) => ({
                ...exercise,
                fatigue: undefined,
                failure: undefined,
              })),
              note: record.payload.data.note,
              status: 'planned',
            },
          }
        : record.payload;
    const saved = enqueueWrite(state, partition, payload);
    if (record.payload.kind === 'workout' && payload.kind === 'workout') {
      if (record.payload.data.status !== 'planned')
        enqueueWrite(
          state,
          partition,
          {
            ...payload,
            data: {
              ...payload.data,
              exercises: record.payload.data.exercises,
              status: 'in_progress',
            },
            action: 'start',
          },
          saved.recordId,
        );
      if (record.payload.data.status === 'completed')
        enqueueWrite(
          state,
          partition,
          {
            ...payload,
            data: {
              ...payload.data,
              exercises: record.payload.data.exercises,
              status: 'completed',
            },
            action: 'complete',
          },
          saved.recordId,
        );
    }
  }
}
export interface WriteStore {
  update<T>(action: (state: WriteState) => T): Promise<T>;
}
export class IndexedWriteStore implements WriteStore {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: IDBFactory | undefined = globalThis.indexedDB) {}
  private open() {
    if (!this.factory) throw new Error('Storage unavailable');
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open('yazio-offline-writes-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onerror = request.onblocked = () => {
        this.database = undefined;
        reject(new Error('Storage unavailable'));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
    }));
  }
  async read(): Promise<WriteState> {
    const db = await this.open();
    const state = await new Promise<WriteState>((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      let result: WriteState;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('Storage unavailable'));
      tx.onerror = () => {};
      const request = tx.objectStore('state').get('current');
      request.onsuccess = () => {
        result = request.result ?? emptyWriteState();
      };
    });
    return state.workoutVersion === 2
      ? state
      : this.update((value) => structuredClone(value));
  }
  async update<T>(action: (state: WriteState) => T): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite', { durability: 'strict' });
      let result: T, failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error('Storage unavailable'));
      tx.onerror = () => {};
      const store = tx.objectStore('state'),
        request = store.get('current');
      request.onsuccess = () => {
        try {
          const state = migrateWorkoutWrites(
            request.result ?? emptyWriteState(),
          );
          result = action(state);
          if (
            new TextEncoder().encode(JSON.stringify(state)).length >
            4 * 1024 * 1024
          )
            throw new Error('Storage limit');
          store.put(state, 'current');
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
}
export async function drainWrites(
  store: WriteStore,
  partition: string,
  send: (
    operation: OfflineWrite,
  ) => Promise<{ status: number; record?: WriteRecord }>,
  now = Date.now,
  maxOperations = 100,
) {
  for (let count = 0; count < maxOperations; count++) {
    const operation = await store.update((state) => {
      const item = nextWrite(state, partition, now());
      if (!item) return null;
      if (item.attempts >= 5) {
        item.status = 'review';
        item.reason = 'retry';
        return null;
      }
      item.status = 'sending';
      item.attempts++;
      return structuredClone(item.operation);
    });
    if (!operation) return;
    let response: { status: number; record?: WriteRecord };
    try {
      response = await send(operation);
    } catch {
      response = { status: 0 };
    }
    await store.update((state) =>
      settleWrite(state, operation.id, response, now()),
    );
    if ([401, 403].includes(response.status)) return;
  }
}
