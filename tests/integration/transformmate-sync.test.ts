import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { syncEngine } from '@/server/workouts/transformmate/engine';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import { workoutPlanInputSchema } from '@/contracts/workouts';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import type { RawResponse } from '@/server/transformmate/types';

const replicaTest = vi.hoisted(() => ({
  database: null as ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  > | null,
  storage: null as import('@/server/storage').ObjectStorage | null,
}));
vi.mock('@/server/db', () => ({
  getDatabase: () => {
    if (!replicaTest.database) throw new Error('No synthetic database');
    return replicaTest.database;
  },
}));
vi.mock('@/server/storage', () => ({
  getObjectStorage: () => {
    if (!replicaTest.storage) throw new Error('No synthetic storage');
    return replicaTest.storage;
  },
}));
vi.mock('server-only', () => ({}));
const raw = <T>(body: T): RawResponse<T> => ({
  body,
  status: 200,
  statusText: 'OK',
  isJson: true,
  contentType: 'application/json',
});
const input = () =>
  workoutPlanInputSchema.parse({
    title: 'Synthetic recovery plan',
    description: '',
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    workouts: [
      {
        id: 'workout',
        date: '2026-01-01',
        title: 'Demo training',
        exercises: [
          {
            name: 'Demo exercise',
            transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
            comment: 'Demo comment',
            sets: [{ reps: 8, weightKg: 10 }],
          },
        ],
      },
    ],
  });

it('recovers a committed TransformMate create after restart without duplicating the POST', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'transformmate-recovery-'));
  const url = `file:${join(directory, 'synthetic.sqlite')}`;
  let database = openDatabase(url);
  try {
    migrate(database.db, { migrationsFolder: './drizzle' });
    database.db
      .insert(user)
      .values({
        id: 'owner',
        name: 'Synthetic',
        role: 'OWNER',
        email: 'owner@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    workoutRepository(database.db).createPlan('owner', input(), randomUUID());
    database.sqlite.close();
    database = openDatabase(url);
    const links = syncRepository(database.db);
    const link = links.list('owner')[0]!;
    const detail = trainingDetailFixture();
    detail.description = link.state.marker;
    const exercise = exerciseDetailFixture();
    exercise.metrics = [3, 4].map((id) => ({
      ...exercise.metrics[0]!,
      id,
      key: id === 3 ? 'weight' : 'reps',
      set_metric_types: [
        {
          name: 'Straight',
          type: 'straight',
          key: '',
          friendly_techniques: [],
        },
      ],
    }));
    let posts = 0;
    const client = {
      getExercise: async () => raw(exercise),
      createTraining: async () => {
        posts++;
        throw new Error('Synthetic committed timeout');
      },
      listTrainings: async () =>
        raw([{ ...trainingSummaryFixture(), description: detail.description }]),
      getTraining: async () =>
        raw(transformMateTrainingDetailSchema.parse(detail)),
    };
    const engine = () =>
      syncEngine({
        repository: syncRepository(database.db),
        client,
        access: async () => {},
        plans: () => workoutRepository(database.db).list('owner').plans,
      });
    await engine().process(link);
    expect(posts).toBe(1);
    expect(links.list('owner')[0]?.state.status).toBe('synced');

    database.sqlite.close();
    database = openDatabase(url);
    const resumed = syncRepository(database.db).list('owner')[0]!;
    await engine().process(resumed);
    expect(posts).toBe(1);
    expect(syncRepository(database.db).list('owner')[0]?.remoteTrainingId).toBe(
      101,
    );
    await assertReplicaRecovery(database, url, directory);
  } finally {
    replicaTest.database = null;
    replicaTest.storage = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (database.sqlite.open) database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function assertReplicaRecovery(
  database: ReturnType<typeof openDatabase>,
  url: string,
  directory: string,
) {
  const { createCatalogStore } =
    await import('@/server/transformmate/catalog-store');
  const { projectDetail } =
    await import('@/server/transformmate/catalog-projection');
  const { createReplicaStore, monthFrom } =
    await import('@/server/transformmate/replica-store');
  const { createReplicaWorker, refreshReplicaJob } =
    await import('@/server/transformmate/replica-worker');
  const { createTransformMateClient } =
    await import('@/server/transformmate/client');
  const { fsObjectStorage } = await import('@/server/storage/fs');
  const { serveReplicaMedia } =
    await import('@/server/transformmate/replica-playback');
  const { selectedVideo } =
    await import('@/server/transformmate/replica-media');
  const { TransformMateStaleConnectionError } =
    await import('@/server/transformmate/token-store');
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = Date.parse('2026-10-17T12:00:00Z');
  vi.setSystemTime(now);
  replicaTest.database = database;
  replicaTest.storage = fsObjectStorage({ rootDir: directory });
  const scope = {
    ownerId: 'owner',
    accountScope: 'a'.repeat(64),
    locale: 'ru' as const,
  };
  const fixture = { ...exerciseDetailFixture(), image: null };
  fixture.kinescope_data[0]!.url =
    'https://kinescopecdn.net/demo.mp4?sign=first';
  const detail = projectDetail(fixture);
  const catalog = () => createCatalogStore(replicaTest.database!.sqlite);
  const store = () => createReplicaStore(replicaTest.database!.sqlite);
  catalog().full(
    scope,
    [{ id: fixture.id, name: fixture.name, metrics: [] }],
    new Date().toISOString(),
  );
  catalog().detail(scope, detail, new Date().toISOString());
  store().bootstrap(scope);
  for (const key of ['catalog', 'dictionary']) {
    const job = store().job(scope, key)!;
    job.next_at = monthFrom(now);
    store().save(scope, job);
  }
  let videoRequests = 0,
    detailRequests = 0,
    revoked = false;
  const synthetic = join(directory, 'synthetic.mp4');
  await promisify(execFile)(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=10',
      '-t',
      '0.5',
      '-c:v',
      'mpeg4',
      '-y',
      synthetic,
    ],
    { timeout: 60000 },
  );
  const bytes = readFileSync(synthetic);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      videoRequests++;
      return new Response(bytes, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(bytes.length),
        },
      });
    }),
  );
  const client = createTransformMateClient({
    baseUrl: 'https://provider.example.test',
    tokenProvider: { getIdToken: async () => 'synthetic' },
    fetch: async () => {
      detailRequests++;
      return Response.json(fixture);
    },
  });
  const access = async () => {
    if (revoked) throw new TransformMateStaleConnectionError();
  };
  const connected = {
    ...scope,
    client,
    assertCurrent: access,
    assertUpstreamCurrent: access,
  };
  const worker = () =>
    createReplicaWorker({
      store: store(),
      refresh: refreshReplicaJob,
      assertOwner: () => {},
      random: () => 0.5,
    });
  await worker().tick(connected);
  expect(videoRequests).toBe(1);
  expect(detailRequests).toBe(0);
  const ready = store().job(scope, 'exercise:501')!;
  expect(ready.data.video).not.toBeNull();
  expect(ready.data.poster).not.toBeNull();
  expect(ready.next_at).toBeGreaterThanOrEqual(now + 25 * 86400000);
  expect(
    selectedVideo({
      ...detail,
      kinescope_data: detail.kinescope_data!.map((m) => ({
        ...m,
        url: m.url!.replace('sign=first', 'sign=second'),
      })),
    })?.fingerprint,
  ).toBe(selectedVideo(detail)?.fingerprint);
  database.sqlite.close();
  replicaTest.database = openDatabase(url);
  try {
    store().bootstrap(scope);
    await worker().tick(connected);
    expect(videoRequests).toBe(1);
    expect(detailRequests).toBe(0);
    expect(
      store().job({ ...scope, accountScope: 'b'.repeat(64) }, ready.key),
    ).toBeNull();
    // The retained copy remains readable with no upstream client.
    const response = await serveReplicaMedia(
      new Request('https://app.example.test/video', {
        headers: { Range: 'bytes=0-15' },
      }),
      { ...connected, client: null },
      501,
      'video',
    );
    expect(response?.status).toBe(206);
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(
      new Uint8Array(bytes.subarray(0, 16)),
    );
    const existing = store().job(scope, ready.key)!;
    existing.data.poster = null;
    existing.data.posterAt = 0;
    existing.next_at = Date.now();
    store().save(scope, existing);
    vi.setSystemTime(now + 10000);
    await worker().tick(connected);
    expect(store().job(scope, ready.key)!.data.poster).not.toBeNull();
    expect(videoRequests).toBe(1);
    // A new version that cannot be committed must not replace the working copy.
    const changed = {
      ...detail,
      kinescope_data: detail.kinescope_data!.map((m) => ({
        ...m,
        id: 'changed-version',
      })),
    };
    catalog().detail(scope, changed, new Date().toISOString());
    const update = store().job(scope, ready.key)!;
    update.next_at = Date.now();
    update.data.videoAt = 0;
    store().save(scope, update);
    vi.setSystemTime(now + 20000);
    vi.spyOn(replicaTest.storage!, 'putStream').mockRejectedValueOnce(
      new Error('Synthetic storage failure'),
    );
    await worker().tick(connected);
    expect(store().job(scope, ready.key)!.data.video?.key).toBe(
      ready.data.video!.key,
    );
    expect(store().state(scope).reason).toBe('storage');
    const failedCalls = videoRequests;
    await worker().tick(connected);
    expect(videoRequests).toBe(failedCalls);
    const persisted = store().state(scope).blocked_until;
    expect(persisted).toBeGreaterThan(Date.now());
    replicaTest.database.sqlite.close();
    replicaTest.database = openDatabase(url);
    await worker().tick(connected);
    expect(videoRequests).toBe(failedCalls);
    expect(store().state(scope).blocked_until).toBe(persisted);
    revoked = true;
    await expect(
      serveReplicaMedia(
        new Request('https://app.example.test/video'),
        connected,
        501,
        'video',
      ),
    ).rejects.toBeInstanceOf(TransformMateStaleConnectionError);
  } finally {
    replicaTest.database.sqlite.close();
  }
}
