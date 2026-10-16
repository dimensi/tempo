import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { fsObjectStorage } from '@/server/storage/fs';
import { VIDEO_PART_BYTES } from '@/contracts/workout-videos';
import { workoutSessionInputSchema } from '@/contracts/workouts';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
vi.mock('@/server/auth/origin', () => ({
  hasTrustedOrigin: (request: Request) =>
    request.headers.get('origin') === 'https://localhost:3000',
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const root = await mkdtemp(join(tmpdir(), 'tempo-video-'));
const storage = fsObjectStorage({ rootDir: root });
vi.mock('@/server/storage', () => ({ getObjectStorage: () => storage }));
const api = await import('@/server/workouts/videos');
const routes = await import('@/app/api/workouts/videos/route');
const playbackRoutes =
  await import('@/app/api/workouts/videos/[id]/playback/route');
const repository = workoutRepository(database.db);
const exerciseId = randomUUID();
let sessionId: string;
function request(
  path = '',
  method = 'GET',
  body?: Uint8Array | object,
  owner = 'owner',
) {
  return new Request(
    `https://localhost:3000/api/workouts/videos${path}?ownerId=${owner}&sessionId=${sessionId}`,
    {
      method,
      headers: { origin: 'https://localhost:3000' },
      body:
        body instanceof Uint8Array
          ? (body as BodyInit)
          : body
            ? JSON.stringify(body)
            : undefined,
    },
  );
}
beforeAll(() => {
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
  ] as const)
    database.db
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
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  sessionId = repository.createSession('owner', {
    date: '2026-10-14',
    title: '',
    note: '',
    status: 'completed',
    exercises: [
      {
        id: exerciseId,
        name: 'Synthetic exercise',
        sets: [{ reps: 10, weightKg: null }],
      },
    ],
  }).id;
  state.session = { user: { id: 'owner', role: 'OWNER' } };
});
afterAll(async () => {
  database.sqlite.close();
  await rm(root, { recursive: true, force: true });
});
it('retains manual occurrence IDs across rename/reorder and assigns fresh IDs to new occurrences', () => {
  const secondId = randomUUID();
  const session = repository.createSession('owner', {
    date: '2026-10-14',
    title: '',
    note: '',
    status: 'completed',
    exercises: [
      { id: exerciseId, name: 'A', sets: [{ reps: 1, weightKg: null }] },
      { id: secondId, name: 'A', sets: [{ reps: 1, weightKg: null }] },
    ],
  });
  const changed = repository.updateSession('owner', session.id, 1, {
    ...session,
    exercises: [...session.exercises]
      .reverse()
      .map((item) => ({ ...item, name: 'Renamed' })),
  });
  expect(changed.exercises.map((item) => item.id)).toEqual([
    secondId,
    exerciseId,
  ]);
  expect(
    workoutSessionInputSchema.safeParse({
      date: '2026-10-14',
      title: '',
      note: '',
      status: 'completed',
      exercises: [session.exercises[0], session.exercises[0]],
    }).success,
  ).toBe(false);
});
it('resumes persisted parts, rejects conflicting retries, finalizes once and serves exact authenticated ranges', async () => {
  const media = await readFile('tests/fixtures/workout-videos/synthetic.mp4');
  // Legal MP4 free atom makes the synthetic clip span more than one upload part.
  const padding = Buffer.alloc(VIDEO_PART_BYTES + 32);
  padding.writeUInt32BE(padding.length);
  padding.write('free', 4);
  const bytes = Buffer.concat([media, padding]);
  const upload = await api.createVideo(
    request('', 'POST', {
      sessionId,
      exerciseId,
      size: bytes.length,
      duration: 2,
    }),
  );
  await api.uploadVideoPart(
    request('', 'PUT', bytes.subarray(0, VIDEO_PART_BYTES)),
    upload.id,
    0,
  );
  await api.uploadVideoPart(
    request('', 'PUT', bytes.subarray(0, VIDEO_PART_BYTES)),
    upload.id,
    0,
  );
  const conflict = Buffer.from(bytes.subarray(0, VIDEO_PART_BYTES));
  conflict[100] = conflict[100]! ^ 1;
  await expect(
    api.uploadVideoPart(request('', 'PUT', conflict), upload.id, 0),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await api.listVideos(request())).find((row) => row.id === upload.id)
      ?.parts,
  ).toEqual([0]);
  await expect(
    api.finalizeVideo(request('', 'POST'), upload.id),
  ).rejects.toMatchObject({ status: 409 });
  await api.uploadVideoPart(
    request('', 'PUT', bytes.subarray(VIDEO_PART_BYTES)),
    upload.id,
    1,
  );
  expect((await api.finalizeVideo(request('', 'POST'), upload.id)).state).toBe(
    'ready',
  );
  expect((await api.finalizeVideo(request('', 'POST'), upload.id)).state).toBe(
    'ready',
  );
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  const range = request();
  range.headers.set('range', 'bytes=10-99');
  const response = await api.playbackVideo(range, upload.id);
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe(
    `bytes 10-99/${bytes.length}`,
  );
  expect(Buffer.from(await response.arrayBuffer())).toEqual(
    bytes.subarray(10, 100),
  );
  await expect(
    api.deleteVideo(request('', 'DELETE'), upload.id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.finalizeVideo(request('', 'POST'), upload.id),
  ).rejects.toMatchObject({ status: 403 });
  const stream = await api.playbackVideo(request(), upload.id);
  database.db
    .delete(trainerAccess)
    .where(eq(trainerAccess.trainerId, 'trainer'))
    .run();
  await expect(stream.arrayBuffer()).rejects.toThrow();
  await expect(api.playbackVideo(range, upload.id)).rejects.toMatchObject({
    status: 403,
  });
  state.session = { user: { id: 'stranger', role: 'OWNER' } };
  await expect(api.playbackVideo(request(), upload.id)).rejects.toMatchObject({
    status: 403,
  });
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const invalid = request();
  invalid.headers.set('range', 'bytes=999999999-');
  expect((await api.playbackVideo(invalid, upload.id)).status).toBe(416);
  await api.deleteVideo(request('', 'DELETE'), upload.id);
  await expect(api.playbackVideo(request(), upload.id)).rejects.toMatchObject({
    status: 404,
  });
});
it('refuses unsupported media and enforces origin, ownership and occurrence target on upload', async () => {
  const bytes = new Uint8Array(256);
  const row = await api.createVideo(
    request('', 'POST', {
      sessionId,
      exerciseId,
      size: bytes.length,
      duration: 2,
    }),
  );
  await api.uploadVideoPart(request('', 'PUT', bytes), row.id, 0);
  await expect(api.finalizeVideo(request('', 'POST'), row.id)).rejects.toThrow(
    SyntaxError,
  );
  const crossSite = request('', 'PUT', bytes);
  crossSite.headers.set('origin', 'https://attacker.test');
  await expect(api.uploadVideoPart(crossSite, row.id, 0)).rejects.toMatchObject(
    { status: 403 },
  );
  await expect(
    api.createVideo(
      request('', 'POST', {
        sessionId,
        exerciseId: randomUUID(),
        size: 256,
        duration: 2,
      }),
    ),
  ).rejects.toMatchObject({ status: 404 });
  state.session = { user: { id: 'stranger', role: 'OWNER' } };
  await expect(
    api.uploadVideoPart(request('', 'PUT', bytes, 'stranger'), row.id, 0),
  ).rejects.toMatchObject({ status: 404 });
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  await api.deleteVideo(request('', 'DELETE'), row.id);
});

it('keeps multiple recordings on the occurrence after rename/reorder and cleans removed exercise/session objects', async () => {
  const workoutApi = await import('@/server/workouts');
  const first = randomUUID(),
    second = randomUUID();
  const session = repository.createSession('owner', {
    date: '2026-10-14',
    title: '',
    note: '',
    status: 'completed',
    exercises: [first, second].map((id) => ({
      id,
      name: 'Same name',
      sets: [{ reps: 10, weightKg: null }],
    })),
  });
  const previousSession = sessionId;
  sessionId = session.id;
  try {
    const bytes = await readFile('tests/fixtures/workout-videos/synthetic.mp4');
    const uploads = [];
    for (let i = 0; i < 2; i++) {
      const row = await api.createVideo(
        request('', 'POST', {
          sessionId,
          exerciseId: first,
          size: bytes.length,
          duration: 2,
        }),
      );
      await api.uploadVideoPart(request('', 'PUT', bytes), row.id, 0);
      await api.finalizeVideo(request('', 'POST'), row.id);
      uploads.push(row);
    }
    const reordered = await workoutApi.updateWorkoutSession(
      new Headers(),
      'owner',
      sessionId,
      session.revision,
      {
        date: session.date,
        title: '',
        note: '',
        status: 'completed',
        exercises: [...session.exercises]
          .reverse()
          .map((item) => ({ ...item, name: 'Renamed' })),
      },
    );
    expect(
      (await api.listVideos(request())).map((row) => row.exerciseId),
    ).toEqual([first, first]);
    await expect(
      workoutApi.updateWorkoutSession(
        new Headers(),
        'owner',
        sessionId,
        reordered.revision,
        {
          date: session.date,
          title: '',
          note: '',
          status: 'completed',
          exercises: [
            { name: 'Renamed', sets: [{ reps: 10, weightKg: null }] },
          ],
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const reduced = await workoutApi.updateWorkoutSession(
      new Headers(),
      'owner',
      sessionId,
      reordered.revision,
      {
        date: session.date,
        title: '',
        note: '',
        status: 'completed',
        exercises: reordered.exercises.filter((item) => item.id === second),
      },
    );
    expect(await api.listVideos(request())).toEqual([]);
    for (const row of uploads)
      await expect(
        storage.get(`workout-videos/${row.id}/video.mp4`),
      ).rejects.toThrow();
    const pending = await api.createVideo(
      request('', 'POST', {
        sessionId,
        exerciseId: second,
        size: bytes.length,
        duration: 2,
      }),
    );
    await api.uploadVideoPart(request('', 'PUT', bytes), pending.id, 0);
    await workoutApi.deleteWorkoutSession(
      new Headers(),
      'owner',
      sessionId,
      reduced.revision,
    );
    await expect(
      storage.get(`workout-videos/${pending.id}/part-0`),
    ).rejects.toThrow();
    await expect(api.listVideos(request())).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    sessionId = previousSession;
  }
});

async function cleanupFixture(ready: boolean) {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const occurrence = randomUUID();
  const session = repository.createSession('owner', {
    date: '2026-10-14',
    title: '',
    note: '',
    status: 'completed',
    exercises: [
      {
        id: occurrence,
        name: 'Synthetic cleanup',
        sets: [{ reps: 10, weightKg: null }],
      },
    ],
  });
  const previousSession = sessionId;
  sessionId = session.id;
  const bytes = await readFile('tests/fixtures/workout-videos/synthetic.mp4');
  const row = await api.createVideo(
    request('', 'POST', {
      sessionId,
      exerciseId: occurrence,
      size: bytes.length,
      duration: 2,
    }),
  );
  await api.uploadVideoPart(request('', 'PUT', bytes), row.id, 0);
  if (ready) await api.finalizeVideo(request('', 'POST'), row.id);
  return {
    session,
    row,
    restore: () => {
      sessionId = previousSession;
    },
  };
}
it.each([true, false])(
  'retains the parent and video manifest when deleting a %s ready session fails, then retries successfully',
  async (ready) => {
    const workoutApi = await import('@/server/workouts');
    const fixture = await cleanupFixture(ready);
    const failureKey = `workout-videos/${fixture.row.id}/${ready ? 'video.mp4' : 'part-0'}`;
    const remove = storage.remove.bind(storage);
    let failed = false;
    const spy = vi.spyOn(storage, 'remove').mockImplementation(async (key) => {
      if (!failed && key === failureKey) {
        failed = true;
        throw new Error('Transient S3 delete failure');
      }
      return remove(key);
    });
    try {
      await expect(
        workoutApi.deleteWorkoutSession(
          new Headers(),
          'owner',
          sessionId,
          fixture.session.revision + 1,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(spy).not.toHaveBeenCalled();
      await expect(
        workoutApi.deleteWorkoutSession(
          new Headers(),
          'owner',
          sessionId,
          fixture.session.revision,
        ),
      ).rejects.toThrow('Transient S3 delete failure');
      expect(
        repository.list('owner').sessions.find((item) => item.id === sessionId)
          ?.revision,
      ).toBe(fixture.session.revision);
      expect((await api.listVideos(request())).map((item) => item.id)).toEqual([
        fixture.row.id,
      ]);
      expect(await storage.get(failureKey)).toBeDefined();
      await workoutApi.deleteWorkoutSession(
        new Headers(),
        'owner',
        sessionId,
        fixture.session.revision,
      );
      await expect(api.listVideos(request())).rejects.toMatchObject({
        status: 404,
      });
      await expect(storage.get(failureKey)).rejects.toThrow();
      expect(api.sessionVideoRows('owner', sessionId)).toEqual([]);
    } finally {
      spy.mockRestore();
      fixture.restore();
    }
  },
);
it('retains an exercise and its video manifest on cleanup failure so the same revision can retry the edit', async () => {
  const workoutApi = await import('@/server/workouts');
  const fixture = await cleanupFixture(true);
  const data = {
    date: fixture.session.date,
    title: '',
    note: '',
    status: 'skipped' as const,
    exercises: [],
  };
  const spy = vi
    .spyOn(storage, 'remove')
    .mockRejectedValueOnce(new Error('Transient S3 delete failure'));
  try {
    await expect(
      workoutApi.updateWorkoutSession(
        new Headers(),
        'owner',
        sessionId,
        fixture.session.revision,
        data,
      ),
    ).rejects.toThrow('Transient S3 delete failure');
    expect(
      repository.list('owner').sessions.find((item) => item.id === sessionId)
        ?.exercises,
    ).toEqual(fixture.session.exercises);
    expect((await api.listVideos(request()))[0]?.id).toBe(fixture.row.id);
    const saved = await workoutApi.updateWorkoutSession(
      new Headers(),
      'owner',
      sessionId,
      fixture.session.revision,
      data,
    );
    expect(saved.exercises).toEqual([]);
    expect(saved.revision).toBe(fixture.session.revision + 1);
    expect(api.sessionVideoRows('owner', sessionId)).toEqual([]);
    await expect(
      storage.get(`workout-videos/${fixture.row.id}/video.mp4`),
    ).rejects.toThrow();
  } finally {
    spy.mockRestore();
    fixture.restore();
  }
});
it('retries failed ready-video part cleanup without losing the manifest or rewriting the published object', async () => {
  const fixture = await cleanupFixture(false);
  const original = await readFile(
    'tests/fixtures/workout-videos/synthetic.mp4',
  );
  const padding = Buffer.alloc(VIDEO_PART_BYTES + 32);
  padding.writeUInt32BE(padding.length);
  padding.write('free', 4);
  const bytes = Buffer.concat([original, padding]);
  const row = await api.createVideo(
    request('', 'POST', {
      sessionId,
      exerciseId: fixture.row.exerciseId,
      size: bytes.length,
      duration: 2,
    }),
  );
  await api.uploadVideoPart(
    request('', 'PUT', bytes.subarray(0, VIDEO_PART_BYTES)),
    row.id,
    0,
  );
  await api.uploadVideoPart(
    request('', 'PUT', bytes.subarray(VIDEO_PART_BYTES)),
    row.id,
    1,
  );
  const remove = storage.remove.bind(storage);
  let failed = false;
  const removeSpy = vi
    .spyOn(storage, 'remove')
    .mockImplementation(async (key) => {
      if (!failed && key === `workout-videos/${row.id}/part-1`) {
        failed = true;
        throw new Error('Transient S3 delete failure');
      }
      return remove(key);
    });
  const putSpy = vi.spyOn(storage, 'putStream');
  try {
    await expect(
      api.finalizeVideo(request('', 'POST'), row.id),
    ).rejects.toThrow('Transient S3 delete failure');
    const saved = (await api.listVideos(request())).find(
      (item) => item.id === row.id,
    )!;
    expect(saved.state).toBe('ready');
    expect(saved.parts).toEqual([0, 1]);
    await expect(
      storage.get(`workout-videos/${row.id}/part-0`),
    ).rejects.toThrow();
    expect(await storage.get(`workout-videos/${row.id}/part-1`)).toBeDefined();
    expect(
      Buffer.from(
        await storage.get(`workout-videos/${row.id}/video.mp4`),
      ).equals(bytes),
    ).toBe(true);
    const retried = await api.finalizeVideo(request('', 'POST'), row.id);
    expect(retried.state).toBe('ready');
    expect(retried.parts).toEqual([]);
    expect(putSpy).toHaveBeenCalledTimes(1);
    await expect(
      storage.get(`workout-videos/${row.id}/part-1`),
    ).rejects.toThrow();
    await api.finalizeVideo(request('', 'POST'), row.id);
    expect(putSpy).toHaveBeenCalledTimes(1);
  } finally {
    removeSpy.mockRestore();
    putSpy.mockRestore();
    fixture.restore();
  }
});
it('serializes new uploads behind parent cleanup so deleting the parent cannot cascade a concurrent upload manifest', async () => {
  const workoutApi = await import('@/server/workouts');
  const fixture = await cleanupFixture(true);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const remove = storage.remove.bind(storage);
  const spy = vi
    .spyOn(storage, 'remove')
    .mockImplementationOnce(async (key) => {
      entered();
      await held;
      return remove(key);
    });
  try {
    const deletion = workoutApi.deleteWorkoutSession(
      new Headers(),
      'owner',
      sessionId,
      fixture.session.revision,
    );
    await started;
    const creation = api.createVideo(
      request('', 'POST', {
        sessionId,
        exerciseId: fixture.row.exerciseId,
        size: 256,
        duration: 2,
      }),
    );
    const rejected = expect(creation).rejects.toMatchObject({ status: 404 });
    // Let the queued request finish parsing before releasing the storage operation.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await deletion;
    await rejected;
    expect(api.sessionVideoRows('owner', sessionId)).toEqual([]);
  } finally {
    release();
    spy.mockRestore();
    fixture.restore();
  }
});

it.each(['GET', 'POST'] as const)(
  'classifies video %s session-wide denial separately from action forbidden',
  async (method) => {
    database.db.delete(trainerAccess).run();
    const invoke = (owner = 'owner') =>
      routes[method](
        request('', method, method === 'POST' ? {} : undefined, owner),
      );
    state.session = null;
    const anonymous = await invoke();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'AUTH_REQUIRED' });
    expect(anonymous.headers.get('X-Auth-Error')).toBe('AUTH_REQUIRED');
    state.session = { user: { id: 'trainer', role: 'TRAINER' } };
    const revoked = await invoke();
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toEqual({ error: 'ACCESS_REVOKED' });
    expect(revoked.headers.get('X-Auth-Error')).toBe('ACCESS_REVOKED');
    database.db
      .insert(trainerAccess)
      .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
      .run();
    const forbidden = await invoke(method === 'GET' ? 'other' : 'owner');
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'FORBIDDEN' });
    expect(forbidden.headers.get('X-Auth-Error')).toBe('FORBIDDEN');
    state.session = { user: { id: 'owner', role: 'OWNER' } };
  },
);
it.each(['GET', 'HEAD'] as const)(
  'classifies video playback %s denial before releasing bytes',
  async (method) => {
    state.session = null;
    const response = await playbackRoutes[method](
      request('/unknown/playback', method),
      { params: Promise.resolve({ id: 'unknown' }) },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('X-Auth-Error')).toBe('AUTH_REQUIRED');
    state.session = { user: { id: 'owner', role: 'OWNER' } };
  },
);
