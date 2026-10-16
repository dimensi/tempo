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
});
