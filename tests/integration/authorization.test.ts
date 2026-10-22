import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { trainerAccess, user } from '@/server/db/schema';
import { medicalMarkerSchema } from '@/contracts/anamnesis';

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  objects: new Map<string, Uint8Array>(),
  beforeObjectRead: null as null | (() => void),
  realAuth: null as null | ReturnType<
    (typeof import('@/server/auth'))['getAuth']
  >,
}));
const database = vi.hoisted(() => ({
  handle: null as null | ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  >,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () =>
    state.realAuth ?? { api: { getSession: async () => state.session } },
}));
vi.mock('@/server/db', async () => {
  const { openDatabase } = await import('@/server/db/connection');
  database.handle ??= openDatabase('file::memory:');
  return { getDatabase: () => database.handle };
});
vi.mock('@/server/storage', () => ({
  getObjectStorage: () => ({
    put: async (key: string, bytes: Uint8Array) =>
      state.objects.set(key, bytes),
    get: async (key: string) => {
      state.beforeObjectRead?.();
      const bytes = state.objects.get(key);
      if (!bytes) throw new Error('Missing synthetic PDF');
      return bytes;
    },
    remove: async (key: string) => state.objects.delete(key),
  }),
}));
vi.mock('@/server/anamnesis/worker', () => ({
  kickAnamnesisImport: () => {},
  anamnesisDocumentStorageKey: (ownerId: string, sha256: string) =>
    `anamnesis/${ownerId}/${sha256}.pdf`,
}));

const { authorize } = await import('@/server/auth/guards');
const { requireCatalogAccess } = await import('@/server/transformmate/catalog');
const { getReplicaStatus } =
  await import('@/server/transformmate/replica-status');
const { ensureAnamnesisCatalog } = await import('@/server/anamnesis/catalog');
const { anamnesisRepository } = await import('@/server/anamnesis/repository');
const anamnesis = await import('@/server/anamnesis');
const headers = () => new Headers({ 'content-type': 'application/json' });
const ownerId = 'owner';
const trainerId = 'trainer';

beforeAll(async () => {
  const connection = database.handle!;
  migrate(connection.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    [ownerId, 'OWNER'],
    [trainerId, 'TRAINER'],
  ] as const)
    connection.db
      .insert(user)
      .values({
        id,
        role,
        name: id,
        email: `${id}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  await ensureAnamnesisCatalog(connection);
});
afterAll(() => database.handle?.sqlite.close());

it('fails closed for generic and selective medical-PDF trainer access, including revocation during a read', async () => {
  const connection = database.handle!;
  state.session = null;
  expect(await authorize(new Headers(), 'nutrition:read', ownerId)).toEqual({
    ok: false,
    status: 401,
  });

  state.session = { user: { id: ownerId, role: 'OWNER' } };
  expect(await authorize(new Headers(), 'nutrition:read')).toEqual({
    ok: false,
    status: 403,
  });
  expect(
    await authorize(new Headers(), 'nutrition:read', 'another-owner'),
  ).toEqual({ ok: false, status: 403 });
  expect((await authorize(new Headers(), 'nutrition:read', ownerId)).ok).toBe(
    true,
  );

  state.session = { user: { id: trainerId, role: 'TRAINER' } };
  expect(await authorize(new Headers(), 'nutrition:read', ownerId)).toEqual({
    ok: false,
    status: 403,
  });
  connection.db
    .insert(trainerAccess)
    .values({ trainerId, ownerId, createdAt: new Date() })
    .run();
  expect((await authorize(new Headers(), 'nutrition:read', ownerId)).ok).toBe(
    true,
  );
  expect(await authorize(new Headers(), 'nutrition:write', ownerId)).toEqual({
    ok: false,
    status: 403,
  });
  const workoutService = await import('@/server/workouts');
  const { workoutRepository } = await import('@/server/workouts/repository');
  const workoutData = {
    date: '2026-09-01',
    title: 'Trainer plan',
    note: '',
    status: 'planned' as const,
    exercises: [],
  };
  const trainerPlan = await workoutService.createWorkout(
    headers(),
    ownerId,
    workoutData,
    crypto.randomUUID(),
  );
  const trainerEdited = await workoutService.updateWorkout(
    headers(),
    ownerId,
    trainerPlan.id,
    trainerPlan.revision,
    { ...workoutData, note: 'Trainer edit' },
    undefined,
    crypto.randomUUID(),
  );
  expect(trainerEdited.note).toBe('Trainer edit');
  await expect(
    workoutService.updateWorkout(
      headers(),
      ownerId,
      trainerEdited.id,
      trainerEdited.revision,
      { ...workoutData, status: 'in_progress' },
      'start',
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  const repository = workoutRepository(connection.db);
  const activeData = {
    ...workoutData,
    exercises: [
      {
        id: crypto.randomUUID(),
        name: 'Squat',
        sets: [{ reps: 8, weightKg: 55 }],
      },
    ],
  };
  const activePlan = repository.create(
    ownerId,
    activeData,
    crypto.randomUUID(),
  );
  const activeWorkout = repository.update(
    ownerId,
    activePlan.id,
    activePlan.revision,
    { ...activeData, status: 'in_progress' },
    'start',
  );
  await expect(
    workoutService.updateWorkout(
      headers(),
      ownerId,
      activeWorkout.id,
      activeWorkout.revision,
      { ...activeData, status: 'in_progress', note: 'Not permitted' },
      undefined,
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(repository.get(ownerId, activeWorkout.id).note).toBe('');
  await expect(
    requireCatalogAccess(headers(), ownerId),
  ).resolves.toBeUndefined();
  await expect(getReplicaStatus(headers())).rejects.toMatchObject({
    status: 403,
  });
  connection.db.delete(trainerAccess).run();
  expect(await authorize(new Headers(), 'nutrition:read', ownerId)).toEqual({
    ok: false,
    status: 403,
  });

  await expect(requireCatalogAccess(headers(), ownerId)).rejects.toMatchObject({
    status: 403,
  });
  connection.db
    .insert(trainerAccess)
    .values({ trainerId, ownerId, createdAt: new Date() })
    .run();
  await assertMedicalPdfGrants();
  // Extend the existing access-boundary scenario: no extra test case or browser infrastructure.
  const actual =
    await vi.importActual<typeof import('@/server/auth')>('@/server/auth');
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  process.env.BETTER_AUTH_SECRET =
    'synthetic-mcp-integration-secret-at-least-32';
  state.realAuth = actual.getAuth();
  const { assertMcpAccess } = await import('./mcp-checks');
  await assertMcpAccess(state.realAuth, connection);
});

async function assertMedicalPdfGrants() {
  const repository = anamnesisRepository(database.handle!.db);
  for (const marker of repository.listMarkers())
    medicalMarkerSchema.parse(marker);
  const now = Date.now();
  repository.insertDocument({
    id: 'granted-document',
    ownerId,
    filename: 'granted.pdf',
    storageKey: 'private/granted.pdf',
    sha256: 'a'.repeat(64),
    mimeType: 'application/pdf',
    sizeBytes: 3,
    pageCount: 1,
    laboratoryName: null,
    title: null,
    collectedAt: null,
    issuedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  repository.insertDocument({
    id: 'hidden-document',
    ownerId,
    filename: 'hidden.pdf',
    storageKey: 'private/hidden.pdf',
    sha256: 'b'.repeat(64),
    mimeType: 'application/pdf',
    sizeBytes: 3,
    pageCount: 1,
    laboratoryName: null,
    title: null,
    collectedAt: null,
    issuedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  repository.insertReport({
    id: 'medical-report',
    ownerId,
    createdBy: ownerId,
    markerIdsJson: ['alt', 'vitamin-d-25oh'],
    dateKeysJson: null,
    historicalPeriodJson: null,
    status: 'ready',
    storageKey: 'private/medical-report.pdf',
    filename: 'medical-report.pdf',
    sizeBytes: 3,
    createdAt: now,
  });
  state.objects.set('private/granted.pdf', new Uint8Array([1, 2, 3]));
  state.objects.set('private/hidden.pdf', new Uint8Array([4, 5, 6]));
  state.objects.set('private/medical-report.pdf', new Uint8Array([7, 8, 9]));
  state.session = { user: { id: trainerId, role: 'TRAINER' } };

  expect(
    await anamnesis.listAnamnesisDocuments(headers(), ownerId),
  ).toHaveLength(0);
  await expect(
    anamnesis.getAnamnesisDocumentFile(headers(), ownerId, 'granted-document'),
  ).rejects.toMatchObject({ status: 403 });

  repository.setDocumentGrant(ownerId, trainerId, 'granted-document', true);
  expect(
    (await anamnesis.listAnamnesisDocuments(headers(), ownerId)).map(
      (document) => document.id,
    ),
  ).toEqual(['granted-document']);
  await expect(
    anamnesis.getAnamnesisDocumentFile(headers(), ownerId, 'hidden-document'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    anamnesis.getAnamnesisDocumentFile(headers(), ownerId, 'granted-document'),
  ).resolves.toMatchObject({ filename: 'granted.pdf' });

  repository.setMarkerGrant(ownerId, trainerId, 'alt', true);
  expect(await anamnesis.listAnamnesisReports(headers(), ownerId)).toHaveLength(
    0,
  );
  await expect(
    anamnesis.getAnamnesisReportFile(headers(), ownerId, 'medical-report'),
  ).rejects.toMatchObject({ status: 403 });

  repository.setMarkerGrant(ownerId, trainerId, 'vitamin-d-25oh', true);
  expect(
    (await anamnesis.listAnamnesisReports(headers(), ownerId)).map(
      (report) => report.id,
    ),
  ).toEqual(['medical-report']);
  state.beforeObjectRead = () =>
    repository.setMarkerGrant(ownerId, trainerId, 'vitamin-d-25oh', false);
  try {
    await expect(
      anamnesis.getAnamnesisReportFile(headers(), ownerId, 'medical-report'),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    state.beforeObjectRead = null;
  }
}
