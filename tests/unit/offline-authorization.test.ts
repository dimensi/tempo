import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  role: 'TRAINER',
  actor: 'trainer',
  subject: 'owner',
  denied: false,
  expiresAt: new Date(Date.now() + 3600000),
  markerGrants: ['marker'],
  documentGrants: ['document'],
  subjectCalls: 0,
  switchAt: Infinity,
  read: vi.fn(() => ({
    diary: [],
    photos: [],
    measurements: [],
    weights: [],
    steps: [],
    plans: [],
    sessions: [],
    nativeTrainings: [],
    transformMateFacts: [],
  })),
  authorize: vi.fn(),
}));
function session() {
  return {
    user: { id: state.actor, role: state.role },
    session: { id: 'session', expiresAt: state.expiresAt },
  };
}
vi.mock('@/server/anamnesis/repository', () => ({
  anamnesisRepository: () => ({
    markerGrantIds: () => new Set(state.markerGrants),
    documentGrantIds: () => new Set(state.documentGrants),
  }),
}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => session() } }),
}));
vi.mock('@/server/auth/guards', () => ({
  authorize: async (_headers: Headers, permission: string, ownerId: string) => {
    state.authorize(permission, ownerId);
    return state.denied || !state.subject || ownerId !== state.subject
      ? { ok: false, status: 403 }
      : { ok: true, session: session() };
  },
}));
vi.mock('@/server/access/owner', () => ({
  getAccessibleOwnerId: async () => {
    state.subjectCalls++;
    if (state.subjectCalls === state.switchAt) state.subject = 'other-owner';
    return state.subject || null;
  },
}));
vi.mock('@/server/env', () => ({
  readServerEnv: () => ({
    BETTER_AUTH_SECRET: 'x'.repeat(64),
    TRANSFORMMATE_TOKEN_FILE: '/tmp/offline-unit/tm.json',
    UPLOADS_DIR: '/tmp/offline-unit/uploads',
  }),
}));
vi.mock('@/server/transformmate/token-store', () => ({
  readTransformMateOfflineBinding: async () => ({
    configured: false,
    connectionId: null,
    revision: 0,
  }),
  transformMateOfflineBindingRevision: () => 0,
  TransformMateStaleConnectionError: class extends Error {},
}));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateBindingFence: async () => ({
    configured: false,
    accountScope: null,
    assertCurrent: async () => {},
    assertBindingCurrent: () => {},
  }),
}));
vi.mock('@/server/nutrition/images', () => ({ readImage: vi.fn() }));
vi.mock('@/server/offline/repository', () => ({
  offlineRepository: () => ({ generation: () => 0, read: state.read }),
}));
vi.mock('@/server/offline/views', () => ({
  readOfflineViews: () => ({
    summary: null,
    settings: null,
    comments: [],
    commentsComplete: true,
    catalog: [],
    catalogComplete: false,
    videos: [],
  }),
}));
vi.mock('@/server/yazio/settings', () => ({ getYazioStatus: vi.fn() }));
import { offlineIdentity, offlineSnapshot } from '@/server/offline';
const headers = new Headers();
const identityUrl = new URL('https://example.test/api/offline/identity');
const snapshotUrl = new URL(
  'https://example.test/api/offline/snapshot?from=2026-10-01&to=2026-10-12',
);
beforeEach(() => {
  Object.assign(state, {
    markerGrants: ['marker'],
    documentGrants: ['document'],
    role: 'TRAINER',
    actor: 'trainer',
    subject: 'owner',
    denied: false,
    expiresAt: new Date(Date.now() + 3600000),
    subjectCalls: 0,
    switchAt: Infinity,
  });
  state.read.mockClear();
  state.authorize.mockClear();
});
it('a trainer reads only the currently granted subject through existing permissions', async () => {
  const snapshot = await offlineSnapshot(headers, snapshotUrl);
  expect(snapshot.role).toBe('TRAINER');
  expect(state.read).toHaveBeenCalledWith(
    'owner',
    '2026-10-01',
    '2026-10-12',
    null,
  );
  expect(state.authorize.mock.calls.every((call) => call[1] === 'owner')).toBe(
    true,
  );
  expect(new Set(state.authorize.mock.calls.map((call) => call[0]))).toEqual(
    new Set([
      'nutrition:read',
      'measurements:read',
      'workouts:read',
      'reports:export',
    ]),
  );
  expect(snapshot.views.settings).toBeNull();
});
it('reader, role, current owner and session are partitioned independently', async () => {
  const trainer = await offlineIdentity(headers, identityUrl);
  state.role = 'OWNER';
  state.actor = 'owner';
  const owner = await offlineIdentity(headers, identityUrl);
  expect(owner.partition).not.toBe(trainer.partition);
  expect(owner.partition).toBe(
    createHmac('sha256', 'x'.repeat(64))
      .update(JSON.stringify(['offline-owner/v1', 'owner']))
      .digest('base64url'),
  );
  state.role = 'TRAINER';
  state.actor = 'trainer';
  state.subject = 'other-owner';
  expect((await offlineIdentity(headers, identityUrl)).partition).not.toBe(
    trainer.partition,
  );
});
it('revocation, missing grants and expired sessions cannot release or populate a copy', async () => {
  state.denied = true;
  await expect(offlineSnapshot(headers, snapshotUrl)).rejects.toMatchObject({
    status: 403,
  });
  expect(state.read).not.toHaveBeenCalled();
  state.denied = false;
  state.subject = '';
  await expect(offlineIdentity(headers, identityUrl)).rejects.toMatchObject({
    status: 403,
  });
  state.subject = 'owner';
  state.expiresAt = new Date(0);
  await expect(offlineSnapshot(headers, snapshotUrl)).rejects.toMatchObject({
    status: 401,
  });
  expect(state.read).not.toHaveBeenCalled();
});
it('a subject switch while local binding awaits fails closed', async () => {
  state.switchAt = 3;
  await expect(offlineSnapshot(headers, snapshotUrl)).rejects.toMatchObject({
    status: 403,
  });
  expect(state.read).not.toHaveBeenCalled();
});

it('medical marker/document revocation changes the reader generation while OWNER queue identity stays stable', async () => {
  const first = await offlineIdentity(headers, identityUrl);
  state.markerGrants = [];
  const markerRevoked = await offlineIdentity(headers, identityUrl);
  expect(markerRevoked.partition).toBe(first.partition);
  expect(markerRevoked.connectionGeneration).not.toBe(
    first.connectionGeneration,
  );
  state.documentGrants = [];
  expect(
    (await offlineIdentity(headers, identityUrl)).connectionGeneration,
  ).not.toBe(markerRevoked.connectionGeneration);
});
