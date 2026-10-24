import { beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authorize: vi.fn(),
  catalog: vi.fn(),
  apply: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: mocks.session } }),
}));
vi.mock('@/server/access/owner', () => ({
  getAccessibleOwnerId: async () => 'owner',
}));
vi.mock('@/server/workouts/videos', () => ({
  withSessionVideoLock: async (
    _owner: string,
    _id: string,
    action: () => Promise<unknown>,
  ) => {
    return action();
  },
}));
vi.mock('@/server/auth/guards', () => ({ authorize: mocks.authorize }));
vi.mock('@/server/env', () => ({
  readServerEnv: () => ({
    BETTER_AUTH_SECRET: 'synthetic-unit-secret',
    BETTER_AUTH_URL: 'https://app.example.test',
  }),
}));
vi.mock('@/server/offline/write-repository', () => ({
  OfflineWriteError: class extends Error {
    constructor(public status: number) {
      super('write failed');
    }
  },
  offlineWriteRepository: () => ({
    catalog: mocks.catalog,
    apply: mocks.apply,
  }),
}));
vi.mock('@/server/yazio/body-repository', () => ({
  bodyRepository: () => ({ schedule: () => null }),
}));
vi.mock('@/server/yazio/body-runtime', () => ({ runBodySync: mocks.sync }));

import {
  readOfflineWrites,
  offlineWriteResponse,
  saveOfflineWrite,
} from '@/server/offline/writes';

const session = () => ({
  user: { id: 'owner', role: 'OWNER' },
  session: { id: 'session', expiresAt: new Date(Date.now() + 60000) },
});
const operation = () => ({
  id: crypto.randomUUID(),
  recordId: crypto.randomUUID(),
  partition: createHmac('sha256', 'synthetic-unit-secret')
    .update(JSON.stringify(['offline-owner/v1', 'owner']))
    .digest('base64url'),
  yazioEpoch: null,
  base: null,
  payload: {
    kind: 'measurement',
    data: {
      measuredAt: '2026-10-15',
      note: null,
      values: [{ metric: 'weight', value: '75', unit: 'kg' }],
    },
  },
});
const request = (body: unknown) =>
  new Request('https://app.example.test/api/offline/writes', {
    method: 'POST',
    headers: {
      Origin: 'https://app.example.test',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(session());
  mocks.authorize.mockResolvedValue({ ok: true, session: session() });
  mocks.catalog.mockReturnValue([]);
  mocks.apply.mockReturnValue({});
  mocks.sync.mockResolvedValue(undefined);
});

it('derives the owner from the session and rejects foreign partitions before a write', async () => {
  const accepted = operation();
  const result = await offlineWriteResponse(() =>
    saveOfflineWrite(request(accepted)),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.apply).toHaveBeenCalledWith('owner', accepted);

  const subdomainRequest = request(accepted);
  subdomainRequest.headers.set('Origin', 'https://preview.dimensi.ru');
  expect(
    (await offlineWriteResponse(() => saveOfflineWrite(subdomainRequest)))
      .status,
  ).toBe(200);

  for (const origin of [
    'https://dimensi.ru.attacker.test',
    'https://notdimensi.ru',
    'http://preview.dimensi.ru',
    'null',
  ]) {
    mocks.apply.mockClear();
    const untrusted = request(accepted);
    untrusted.headers.set('Origin', origin);
    expect(
      (await offlineWriteResponse(() => saveOfflineWrite(untrusted))).status,
    ).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  }

  mocks.apply.mockClear();
  const foreign = await offlineWriteResponse(() =>
    saveOfflineWrite(
      request({
        ...accepted,
        id: crypto.randomUUID(),
        partition: 'b'.repeat(43),
      }),
    ),
  );
  expect(foreign.status).toBe(403);
  expect(mocks.apply).not.toHaveBeenCalled();

  const trainerSession = {
    ...session(),
    user: { id: 'trainer', role: 'TRAINER' },
  };
  mocks.session.mockResolvedValue(trainerSession);
  mocks.authorize.mockImplementation(async (_headers, permission) =>
    permission === 'measurements:write'
      ? { ok: false, status: 403 }
      : { ok: true, session: trainerSession },
  );
  const trainerPartition = createHmac('sha256', 'synthetic-unit-secret')
    .update(
      JSON.stringify(['offline-reader/v2', 'trainer', 'TRAINER', 'owner']),
    )
    .digest('base64url');
  expect(await readOfflineWrites(new Headers())).toEqual({
    partition: trainerPartition,
    yazioEpoch: null,
    records: [],
  });
  expect(mocks.catalog).toHaveBeenLastCalledWith('owner', ['workout']);
  const trainerWorkout = {
    ...operation(),
    partition: trainerPartition,
    payload: {
      kind: 'workout',
      data: {
        date: '2026-10-15',
        title: 'Trainer workout',
        note: '',
        status: 'in_progress',
        exercises: [{ name: 'Squat', sets: [{ reps: 8, weightKg: 60 }] }],
      },
      action: 'start',
    },
  };
  mocks.apply.mockReturnValue({ payload: trainerWorkout.payload });
  expect(
    (
      await offlineWriteResponse(() =>
        saveOfflineWrite(request(trainerWorkout)),
      )
    ).status,
  ).toBe(200);
  expect(mocks.apply).toHaveBeenLastCalledWith('owner', trainerWorkout);

  mocks.apply.mockClear();
  expect(
    (
      await offlineWriteResponse(() =>
        saveOfflineWrite(
          request({
            ...operation(),
            partition: trainerPartition,
          }),
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await offlineWriteResponse(() =>
        saveOfflineWrite(
          request({
            ...trainerWorkout,
            partition: accepted.partition,
          }),
        ),
      )
    ).status,
  ).toBe(403);
  expect(mocks.apply).not.toHaveBeenCalled();

  mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
  expect(
    (
      await offlineWriteResponse(() =>
        saveOfflineWrite(request(trainerWorkout)),
      )
    ).status,
  ).toBe(403);
  expect(mocks.apply).not.toHaveBeenCalled();
});
