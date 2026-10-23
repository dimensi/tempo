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
import { publicationFor } from '@/server/workouts/transformmate/publication';
import { publicationWorkoutSchema } from '@/contracts/workout-publication';
import { workoutInputSchema } from '@/contracts/workouts';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import {
  createTrainingInputSchema,
  type CreateTrainingInput,
  type TrainingWriteBody,
} from '@/server/transformmate/write-inputs';
import type {
  RawResponse,
  TransformMateTrainingDetail,
  TransformMateExerciseDetail,
} from '@/server/transformmate/types';

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
  workoutInputSchema.parse({
    title: 'Demo training',
    note: '',
    status: 'planned',
    date: '2026-01-01',
    exercises: [
      {
        name: 'Demo exercise',
        transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
        comment: 'Demo comment',
        sets: [{ reps: 8, weightKg: 10 }],
      },
    ],
  });

it('recovers provider creates and completed results across restarts without duplicates or overwriting external edits', async () => {
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
    workoutRepository(database.db).create('owner', input(), randomUUID());
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
        workouts: () => workoutRepository(database.db).list('owner').workouts,
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
    const workouts = workoutRepository(database.db);
    const planned = workouts.get('owner', resumed.planId);
    const values = {
      date: planned.date,
      title: planned.title,
      note: planned.note,
      exercises: planned.exercises,
    };
    const started = workouts.update(
      'owner',
      planned.id,
      planned.revision,
      { ...values, status: 'in_progress' },
      'start',
    );
    const feedback = {
      exerciseId: started.exercises[0]!.id!,
      fatigue: 9,
      failure: 'full' as const,
    };
    const rated = workouts.updateFeedback(
      'owner',
      started.id,
      started.revision,
      feedback,
      randomUUID(),
    );
    const projection = publicationWorkoutSchema.parse(
      publicationFor(rated).workouts[0],
    );
    expect(projection.exercises[0]).not.toHaveProperty('fatigue');
    expect(projection.exercises[0]).not.toHaveProperty('failure');
    const completed = workouts.update(
      'owner',
      rated.id,
      rated.revision,
      { ...values, exercises: rated.exercises, status: 'completed' },
      'complete',
    );
    const linkBeforeFeedback = syncRepository(database.db).list('owner');
    const corrected = workouts.updateFeedback(
      'owner',
      completed.id,
      completed.revision,
      { ...feedback, fatigue: 10 },
      randomUUID(),
    );
    expect(syncRepository(database.db).list('owner')).toEqual(
      linkBeforeFeedback,
    );
    expect(syncRepository(database.db).list('owner')[0]!.state.workout).toEqual(
      linkBeforeFeedback[0]!.state.workout,
    );
    expect(
      syncRepository(database.db).list('owner')[0]!.state.published,
    ).toEqual(linkBeforeFeedback[0]!.state.published);
    expect(workouts.get('owner', corrected.id).exercises[0]).toMatchObject({
      fatigue: 10,
      failure: 'full',
    });
    expect(posts).toBe(1);
    await assertCustomExecutionRecovery(database, url);
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
  const { replicaMediaRequest, replicaRequest } =
    await import('@/server/transformmate/replica-gate');
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
    revoked = false,
    metadataGone = false;
  let metadataImage: string | null = null;
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
      return metadataGone
        ? Response.json({ detail: 'gone' }, { status: 404 })
        : Response.json({ ...fixture, image: metadataImage });
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
    expect(store().status(scope, Date.now()).failureGroups).toMatchObject([
      {
        stage: 'video',
        count: 1,
        examples: [{ id: 501, reason: 'storage', httpStatus: null }],
      },
    ]);
    // Storage backoff pauses replication, while upstream playback stays available.
    const reserve = await replicaMediaRequest(
      scope,
      async () => new Response('synthetic reserve'),
    );
    expect(await reserve.text()).toBe('synthetic reserve');
    await expect(
      replicaMediaRequest(
        scope,
        async () =>
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': '120' },
          }),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(store().state(scope).reason).toBe('upstream');
    expect(store().state(scope).blocked_until).toBeGreaterThanOrEqual(
      Date.now() + 120000,
    );
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
    vi.setSystemTime(persisted + 10000);
    let finishRange!: (response: Response) => void;
    const earlierRange = replicaMediaRequest(
      scope,
      () =>
        new Promise<Response>((resolve) => {
          finishRange = resolve;
        }),
    );
    await expect(
      replicaMediaRequest(
        scope,
        async () =>
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': '180' },
          }),
      ),
    ).rejects.toMatchObject({ status: 429 });
    const concurrentCooldown = store().state(scope).blocked_until;
    finishRange(new Response('earlier range'));
    await earlierRange;
    expect(store().state(scope).blocked_until).toBe(concurrentCooldown);
    vi.setSystemTime(concurrentCooldown + 10000);
    await replicaMediaRequest(scope, async () => new Response('recovered'));
    expect(store().state(scope)).toMatchObject({
      reason: null,
      failures: 0,
      blocked_until: 0,
    });
    const canceled = new AbortController();
    canceled.abort();
    await expect(
      replicaMediaRequest(
        scope,
        async () => {
          throw canceled.signal.reason;
        },
        canceled.signal,
      ),
    ).rejects.toBeDefined();
    expect(store().state(scope).reason).toBeNull();
    const concurrentJob = store().job(scope, ready.key)!;
    concurrentJob.next_at = Date.now();
    store().save(scope, concurrentJob);
    await createReplicaWorker({
      store: store(),
      refresh: async () => {
        await expect(
          replicaMediaRequest(
            scope,
            async () =>
              new Response(null, {
                status: 429,
                headers: { 'Retry-After': '240' },
              }),
          ),
        ).rejects.toMatchObject({ status: 429 });
      },
      assertOwner: () => {},
    }).tick(connected);
    expect(store().state(scope).reason).toBe('upstream');
    expect(store().state(scope).blocked_until).toBeGreaterThanOrEqual(
      Date.now() + 240000,
    );
    vi.setSystemTime(store().state(scope).blocked_until + 10000);
    const missingPoster = store().job(scope, ready.key)!;
    missingPoster.data.detailAt = 0;
    missingPoster.data.poster = null;
    missingPoster.data.posterAt = 0;
    missingPoster.next_at = Date.now();
    store().save(scope, missingPoster);
    metadataGone = true;
    await worker().tick(connected);
    expect(store().job(scope, ready.key)!.data.poster).not.toBeNull();
    expect(store().job(scope, ready.key)!.data.detailAt).toBe(0);
    expect(store().job(scope, ready.key)!.data.failures.metadata).toMatchObject(
      { reason: 'not_found', httpStatus: 404 },
    );
    expect(videoRequests).toBe(failedCalls);
    store().patch(scope, {
      reason: null,
      failures: 0,
      blocked_until: 0,
      next_request_at: 0,
    });
    await expect(
      replicaRequest(scope, async () => {
        throw new TransformMateStaleConnectionError();
      }),
    ).rejects.toBeInstanceOf(TransformMateStaleConnectionError);
    expect(store().state(scope).reason).toBeNull();
    vi.setSystemTime(Date.now() + 10000);
    const { CatalogError } = await import('@/server/transformmate/errors');
    await expect(
      replicaRequest(scope, async () => {
        throw new CatalogError(403);
      }),
    ).rejects.toBeInstanceOf(CatalogError);
    expect(store().state(scope).reason).toBeNull();
    const blockedImage = store().job(scope, ready.key)!;
    const imageUrl =
      'https://transformmate.pht.space/ipt/media/synthetic-missing.jpg';
    metadataGone = false;
    metadataImage = imageUrl;
    fixture.kinescope_data[0]!.id = 'stage-split-version';
    catalog().detail(
      scope,
      { ...detail, image: imageUrl },
      new Date().toISOString(),
    );
    blockedImage.data.detailAt = 0;
    blockedImage.data.imageAt = 0;
    blockedImage.data.videoAt = 0;
    blockedImage.next_at = Date.now();
    store().save(scope, blockedImage);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) =>
        new URL(input).hostname === 'transformmate.pht.space'
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 403 }),
      ),
    );
    vi.setSystemTime(Date.now() + 10000);
    await worker().tick(connected);
    expect(store().job(scope, ready.key)!.data.failures).toMatchObject({
      image: { reason: 'not_found', httpStatus: 404 },
      video: { reason: 'forbidden', httpStatus: 403 },
    });
    expect(store().job(scope, ready.key)!.data.video?.key).toBe(
      ready.data.video!.key,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) =>
        new URL(input).hostname === 'transformmate.pht.space'
          ? new Response(null, { status: 404 })
          : new Response(bytes, {
              headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(bytes.length),
              },
            }),
      ),
    );
    const retryImage = store().job(scope, ready.key)!;
    retryImage.next_at = Date.now();
    retryImage.data.detailAt = Date.now() + 86400000;
    store().save(scope, retryImage);
    vi.setSystemTime(Date.now() + 10000);
    await worker().tick(connected);
    const separated = store().status(scope, Date.now()).failureGroups;
    expect(separated).toMatchObject([
      {
        stage: 'image',
        count: 1,
        examples: [{ id: 501, reason: 'not_found', httpStatus: 404 }],
      },
    ]);
    expect(store().job(scope, ready.key)!.data.failures.video).toBeUndefined();
    const recovered = store().job(scope, ready.key)!;
    expect(recovered.attempts).toBe(0);
    expect(recovered.data.imageAt).toBeGreaterThan(Date.now() + 24 * 3600000);
    expect(recovered.next_at).toBeGreaterThan(Date.now());
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([input]) =>
            new URL(input as string).hostname !== 'transformmate.pht.space',
        ),
    ).toBe(true);
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

async function assertCustomExecutionRecovery(
  database: ReturnType<typeof openDatabase>,
  url: string,
) {
  const manual = input();
  manual.exercises = [
    { name: 'Manual demo exercise', sets: [{ reps: 8, weightKg: 10 }] },
  ];
  const saved = workoutRepository(database.db).create(
    'owner',
    manual,
    randomUUID(),
  );
  let custom: TransformMateExerciseDetail | undefined;
  let remote: TransformMateTrainingDetail | undefined;
  let customPosts = 0,
    trainingPosts = 0,
    patches = 0,
    lookupHidden = false,
    getFails = false,
    commitTimeout = false;
  let sequence = 1000;
  const detail = (body: TrainingWriteBody): TransformMateTrainingDetail => {
    const template = trainingDetailFixture();
    return transformMateTrainingDetailSchema.parse({
      ...template,
      id: 102,
      name: body.name,
      description: body.description,
      date: body.date,
      started: body.started ?? null,
      finished: body.finished ?? null,
      progress: body.finished ? 'done' : body.started ? 'in_progress' : 'idle',
      protocols: body.protocols.map((protocol, pi) => ({
        id: protocol.id ?? ++sequence,
        order: pi + 1,
        workout_exercises: protocol.workout_exercises.map((exercise, ei) => ({
          ...template.protocols[0]!.workout_exercises[0]!,
          id: exercise.id ?? ++sequence,
          order: ei + 1,
          exercise: { id: exercise.exercise, name: 'Manual demo exercise' },
          comment: exercise.comment,
          exercise_metrics: exercise.exercise_metrics.map((id) => ({
            id,
            name: String(id),
          })),
          metrics: exercise.metrics.map((group) => ({
            id: group.id ?? ++sequence,
            type: group.type,
            sets: group.sets.map((set, si) => ({
              id: set.id ?? ++sequence,
              order: si + 1,
              techniques: set.techniques ?? [],
              ...(group.type === 'fact'
                ? { is_done: set.is_done ?? false }
                : {}),
              set_metrics: set.set_metrics.map((metric) => ({
                id: metric.id ?? ++sequence,
                type: metric.type ?? 'straight',
                measure: {
                  id: metric.measure,
                  key: metric.measure === 3 ? 'weight' : 'reps',
                  name: String(metric.measure),
                  short_name: String(metric.measure),
                },
                metric_values: metric.metric_values.map((value) => ({
                  id: value.id ?? ++sequence,
                  value: value.value,
                })),
              })),
            })),
          })),
        })),
      })),
    });
  };
  const client = {
    getExercise: async () => raw(custom!),
    listExercises: async () => {
      if (lookupHidden) {
        lookupHidden = false;
        return raw([]);
      }
      return raw(
        custom ? [{ id: custom.id, name: custom.name, metrics: [] }] : [],
      );
    },
    createCustomExercise: async (
      body: { name: string; description: string },
      guard?: () => Promise<void>,
    ) => {
      await guard?.();
      customPosts++;
      custom = {
        ...exerciseDetailFixture(),
        id: 502,
        name: body.name,
        description: body.description,
        author: 201,
        exercise_type: { id: 4, name: 'Пользовательский' },
        metrics: [],
      };
      lookupHidden = true;
      throw new Error('Synthetic custom POST committed, response lost');
    },
    createTraining: async (
      body: CreateTrainingInput,
      guard?: () => Promise<void>,
    ) => {
      await guard?.();
      trainingPosts++;
      remote = detail(createTrainingInputSchema.parse(body));
      return raw({ id: 102 });
    },
    listTrainings: async () => raw([]),
    getTraining: async () => {
      if (getFails) {
        getFails = false;
        throw new Error('Synthetic GET unavailable');
      }
      return raw(structuredClone(remote!));
    },
    updateTrainingOnce: async (
      _id: number,
      body: TrainingWriteBody,
      guard?: () => Promise<void>,
    ) => {
      await guard?.();
      patches++;
      remote = detail(body);
      if (commitTimeout) {
        commitTimeout = false;
        getFails = true;
        throw new Error('Synthetic committed PATCH timeout');
      }
      return raw({ id: 102 });
    },
  };
  const process = async (canLog = true, targetId = saved.id) => {
    const links = syncRepository(database.db);
    await syncEngine({
      repository: links,
      client,
      accountScope: 'a'.repeat(64),
      authorId: 201,
      access: async () => {},
      canLog: async () => canLog,
      workouts: () => workoutRepository(database.db).list('owner').workouts,
    }).process(links.list('owner').find((link) => link.planId === targetId)!);
  };
  await process();
  expect(customPosts).toBe(1);
  expect(trainingPosts).toBe(0);
  const another = workoutRepository(database.db).create(
    'owner',
    manual,
    randomUUID(),
  );
  lookupHidden = true;
  await process(true, another.id);
  expect(customPosts).toBe(1);
  expect(trainingPosts).toBe(0);
  database.sqlite.close();
  const reopened = openDatabase(url);
  // Keep the caller's database handle valid for its replica recovery assertions.
  Object.assign(database, reopened);
  await process();
  expect(customPosts).toBe(1);
  expect(trainingPosts).toBe(1);
  const localInput = (status: 'in_progress' | 'completed') => {
    const current = workoutRepository(database.db).get('owner', saved.id);
    return {
      date: current.date,
      title: current.title,
      note: current.note,
      exercises: current.exercises,
      status,
    };
  };
  let local = workoutRepository(database.db).get('owner', saved.id);
  local = workoutRepository(database.db).update(
    'owner',
    saved.id,
    local.revision,
    localInput('in_progress'),
    'start',
  );
  await process();
  expect(remote!.progress).toBe('in_progress');
  expect(patches).toBe(1);
  const finished = localInput('completed');
  finished.exercises[0]!.sets = [{ reps: 12, weightKg: 11 }];
  workoutRepository(database.db).update(
    'owner',
    saved.id,
    local.revision,
    finished,
    'complete',
  );
  commitTimeout = true;
  await process();
  expect(
    syncRepository(database.db)
      .list('owner')
      .find((link) => link.planId === saved.id)?.state.execution?.phase,
  ).toBe('unknown');
  // A newer local resume must wait for the unknown completion to settle, then publish.
  const completedLocal = workoutRepository(database.db).get('owner', saved.id);
  const resumed = workoutRepository(database.db).update(
    'owner',
    saved.id,
    completedLocal.revision,
    localInput('in_progress'),
    'resume',
  );
  database.sqlite.close();
  Object.assign(database, openDatabase(url));
  await process();
  expect(remote!.progress).toBe('in_progress');
  expect(remote!.finished).toBeNull();
  expect(patches).toBe(3);
  workoutRepository(database.db).update(
    'owner',
    saved.id,
    resumed.revision,
    localInput('completed'),
    'complete',
  );
  await process();
  const verified = syncRepository(database.db)
    .list('owner')
    .find((link) => link.planId === saved.id)!;
  expect(verified.state.status).toBe('synced');
  expect(verified.state.execution?.phase).toBe('verified');
  expect(patches).toBe(4);
  expect(remote!.progress).toBe('done');
  expect(
    remote!.protocols[0]!.workout_exercises[0]!.metrics.find(
      (group) => group.type === 'fact',
    )!.sets[0],
  ).toMatchObject({
    is_done: true,
    set_metrics: [
      { metric_values: [{ value: '11' }] },
      { metric_values: [{ value: '12' }] },
    ],
  });
  expect(
    remote!.protocols[0]!.workout_exercises[0]!.metrics.find(
      (group) => group.type === 'plan',
    )!.sets[0]!.set_metrics[0]!.metric_values[0]!.value,
  ).toBe('10');
  await process(false);
  expect(patches).toBe(4);
  remote!.protocols[0]!.workout_exercises[0]!.metrics.find(
    (group) => group.type === 'fact',
  )!.sets[0]!.set_metrics[0]!.metric_values[0]!.value = '99';
  await process();
  expect(
    syncRepository(database.db)
      .list('owner')
      .find((link) => link.planId === saved.id)?.state,
  ).toMatchObject({ status: 'conflict', reason: 'remote_changed' });
  expect(patches).toBe(4);
  expect(customPosts).toBe(1);
}
