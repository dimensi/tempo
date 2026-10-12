import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hashPassword } from 'better-auth/crypto';
import { openDatabase } from '@/server/db/connection';
import { user, account, trainerAccess } from '@/server/db/schema';
import { syntheticDay } from '../unit/reports/fixtures';
vi.mock('server-only', () => ({}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
import { getAuth } from '@/server/auth';
import * as images from '@/server/nutrition/images';
import * as repository from '@/server/offline/repository';
import { GET as identityGET } from '@/app/api/offline/identity/route';
import { GET as snapshotGET } from '@/app/api/offline/snapshot/route';
import { GET as photoGET } from '@/app/api/offline/photos/[opaque]/route';
import { offlineSnapshotSchema, offlineLimits } from '@/contracts/offline';
const ownerId = 'owner-private-identity';
const directory = mkdtempSync(join(tmpdir(), 'offline-read-test-'));
let ownerHeaders: Headers;
let trainerHeaders: Headers;
async function login(id: string) {
  const response = await getAuth().api.signInEmail({
    body: { email: id + '@example.test', password: 'Synthetic-password-12345' },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  });
}
beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'offline-only-synthetic-secret-at-least-32-characters',
  );
  vi.stubEnv('TRANSFORMMATE_TOKEN_FILE', join(directory, 'missing-tm.json'));
  vi.stubEnv('UPLOADS_DIR', join(directory, 'uploads'));
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    [ownerId, 'OWNER'],
    ['trainer', 'TRAINER'],
  ] as const) {
    database.db
      .insert(user)
      .values({
        id,
        role,
        name: 'Synthetic',
        email: id + '@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    database.db
      .insert(account)
      .values({
        id: 'credential-' + id,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword('Synthetic-password-12345'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }
  ownerHeaders = await login(ownerId);
  trainerHeaders = await login('trainer');
  const day = syntheticDay('2026-10-12');
  day.meals[0]!.entries[0]!.id = 'UPSTREAM_PRIVATE_ENTRY';
  day.meals[0]!.entries[0]!.sourceId = 'UPSTREAM_PRIVATE_PRODUCT';
  database.sqlite
    .prepare(
      'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES (?,?,?,?)',
    )
    .run(ownerId, day.date, JSON.stringify(day), day.fetchedAt);
  database.sqlite
    .prepare(
      'INSERT INTO measurements(id,owner_id,measured_at,values_json,note) VALUES (?,?,?,?,?)',
    )
    .run(
      'manual-private-id',
      ownerId,
      '2026-10-12',
      JSON.stringify([
        { metric: 'weight', value: '72', unit: 'kg' },
        { metric: 'waist', value: '80', unit: 'cm' },
        { metric: 'neck', value: '38', unit: 'cm' },
      ]),
      'Synthetic note',
    );
  database.sqlite
    .prepare(
      'INSERT INTO yazio_weight_entries(owner_id,external_id,provider_date,measured_date,raw_value,unit_context,observed_at,upstream_source,gateway) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .run(
      ownerId,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-10-12',
      '2026-10-12',
      '160',
      'lb',
      '2026-10-12T12:00:00Z',
      'PRIVATE_GATEWAY',
      'PRIVATE_SOURCE',
    );
  const insert = database.sqlite.prepare(
    'INSERT INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES (?,?,?,?)',
  );
  insert.run(ownerId, '2026-10-12', 0, '2026-10-12T12:00:00Z');
  insert.run(ownerId, '2026-10-11', null, '2026-10-12T12:00:00Z');
  const exercise = {
    name: 'Synthetic squat',
    sets: [{ reps: 5, weightKg: 0 }],
    transformMate: {
      exerciseId: 918273,
      occurrenceKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  };
  const plan = {
    title: 'Synthetic plan',
    description: 'Synthetic description',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
    workouts: [
      {
        id: 'private-planned-id',
        date: '2026-10-12',
        title: 'Planned',
        exercises: [exercise],
      },
      {
        id: 'outside',
        date: '2026-10-01',
        title: 'Outside range',
        exercises: [exercise],
      },
    ],
  };
  database.sqlite
    .prepare(
      'INSERT INTO workout_plans(id,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?)',
    )
    .run(
      'private-plan-id',
      ownerId,
      JSON.stringify(plan),
      '2026-10-01T00:00:00Z',
      '2026-10-12T00:00:00Z',
    );
  const session = {
    date: '2026-10-12',
    title: 'Completed',
    note: 'Synthetic result',
    status: 'completed',
    exercises: [exercise],
    planId: 'private-plan-id',
    plannedWorkoutId: 'private-planned-id',
    planSnapshot: { planTitle: 'Synthetic plan', workout: plan.workouts[0] },
  };
  database.sqlite
    .prepare(
      'INSERT INTO workout_sessions(id,owner_id,data,date,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    )
    .run(
      'private-session-id',
      ownerId,
      JSON.stringify(session),
      session.date,
      '2026-10-12T00:00:00Z',
      '2026-10-12T00:00:00Z',
    );
  const actual = {
    date: '2026-10-12',
    title: 'Cached fact',
    started: null,
    finished: null,
    exercises: [
      {
        name: 'Synthetic squat',
        exerciseId: 918273,
        occurrenceKey: 'private-occurrence',
        comment: 'Synthetic fact',
        sets: [
          {
            order: 1,
            done: true,
            metrics: [
              { name: 'weight', unit: 'kg', type: 'number', values: ['0'] },
            ],
          },
        ],
      },
    ],
  };
  database.sqlite
    .prepare(
      'INSERT INTO workout_transformmate_links(id,owner_id,plan_id,workout_id,remote_training_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'private-link-id',
      ownerId,
      'private-plan-id',
      'private-planned-id',
      918274,
      JSON.stringify({
        actual,
        checkedAt: '2026-10-12T12:00:00Z',
        expected: 'PRIVATE_EXPECTED_TOKEN',
        baseline: 'https://signed.example.test/private',
      }),
      '2026-10-12T00:00:00Z',
      '2026-10-12T00:00:00Z',
    );
  database.sqlite
    .prepare(
      'INSERT INTO nutrition_photos(id,owner_id,date,daytime,source,storage_key,content_hash,source_url,observed_at,mime) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      ownerId + ':2026-10-12:breakfast:yazio',
      ownerId,
      '2026-10-12',
      'breakfast',
      'yazio',
      'a'.repeat(64),
      'a'.repeat(64),
      'https://signed.example.test/private',
      '2026-10-12T12:00:00Z',
      'image/jpeg',
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  database.db.delete(trainerAccess).run();
});
afterAll(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const request = (
  headers: Headers,
  path = 'snapshot?from=2026-10-11&to=2026-10-12',
) => new Request('http://localhost/api/offline/' + path, { headers });
it('actual sessions restrict offline access to OWNER even with trainer grant', async () => {
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId, createdAt: new Date() })
    .run();
  expect((await identityGET(request(new Headers(), 'identity'))).status).toBe(
    401,
  );
  expect((await snapshotGET(request(trainerHeaders))).status).toBe(403);
  expect((await identityGET(request(trainerHeaders, 'identity'))).status).toBe(
    403,
  );
});
it('strict query rejects owner selectors, duplicates, invalid/reversed dates and over30 days', async () => {
  for (const query of [
    'from=2026-10-01&to=2026-10-31',
    'from=2026-02-30&to=2026-10-12',
    'from=2026-10-12&to=2026-10-11',
    'from=2026-10-12&to=2026-10-12&ownerId=private',
    'from=2026-10-12&from=2026-10-12&to=2026-10-12',
  ])
    expect(
      (await snapshotGET(request(ownerHeaders, 'snapshot?' + query))).status,
    ).toBe(400);
  expect(
    (await identityGET(request(ownerHeaders, 'identity?from=2026-10-12')))
      .status,
  ).toBe(400);
});
it('safe local projection preserves null/zero/notes/workouts/facts while stripping identities and locators', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Provider requests forbidden'));
  const response = await snapshotGET(request(ownerHeaders));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const value = offlineSnapshotSchema.parse(await response.json());
  expect(value.dailySteps.map((day) => day.steps)).toEqual([null, 0]);
  expect(value.importedWeights[0]).toMatchObject({
    unit: null,
    unitContext: 'lb',
    rawValue: '160',
  });
  expect(value.measurements[0]?.values).toHaveLength(3);
  expect(value.measurements[0]?.note).toBe('Synthetic note');
  expect(value.plannedWorkouts).toHaveLength(1);
  expect(value.workoutSessions[0]?.status).toBe('completed');
  expect(value.plannedWorkouts[0]?.exercises[0]?.sets[0]?.weightKg).toBe(0);
  expect(
    value.transformMateFacts[0]?.exercises[0]?.sets[0]?.metrics[0]?.values,
  ).toEqual(['0']);
  expect(value.photos.availability).toBe('metadata-only');
  expect(value.photos.items[0]?.downloadUrl).toMatch(
    /^\/api\/offline\/photos\/[^?]+\?date=2026-10-12$/,
  );
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    ownerId,
    'UPSTREAM_PRIVATE',
    'private-plan-id',
    'private-occurrence',
    '918273',
    '918274',
    'PRIVATE_GATEWAY',
    'PRIVATE_SOURCE',
    'PRIVATE_EXPECTED_TOKEN',
    'signed.example.test',
    'storageKey',
    'refreshToken',
    'sourceId',
  ])
    expect(serialized).not.toContain(forbidden);
  expect(
    Date.parse(value.expiresAt) - Date.parse(value.serverNow),
  ).toBeLessThanOrEqual(offlineLimits.lifetimeMs);
  expect(Date.parse(value.expiresAt)).toBeLessThanOrEqual(
    Date.parse(value.sessionExpiresAt),
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('snapshot post-read session revocation and connection changes fail closed', async () => {
  const repo = repository.offlineRepository();
  vi.spyOn(repository, 'offlineRepository').mockReturnValue({
    ...repo,
    read: (...args) => {
      const result = repo.read(...args);
      database.sqlite
        .prepare('DELETE FROM session WHERE user_id = ?')
        .run(ownerId);
      return result;
    },
  });
  expect((await snapshotGET(request(ownerHeaders))).status).toBe(401);
  vi.restoreAllMocks();
  ownerHeaders = await login(ownerId);
  vi.spyOn(repository, 'offlineRepository').mockReturnValue({
    ...repo,
    read: (...args) => {
      const result = repo.read(...args);
      database.sqlite
        .prepare(
          'INSERT INTO nutrition_schedule(owner_id,epoch) VALUES (?,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=epoch+1',
        )
        .run(ownerId);
      return result;
    },
  });
  expect((await snapshotGET(request(ownerHeaders))).status).toBe(409);
});
it('identity caps offline expiry at the actual session expiry after normal auth refresh', async () => {
  const expiry = Date.now() + 60000;
  database.sqlite
    .prepare('UPDATE session SET expires_at = ? WHERE user_id = ?')
    .run(expiry, ownerId);
  const response = await identityGET(request(ownerHeaders, 'identity'));
  expect(response.status).toBe(200);
  const value = await response.json();
  const persisted = database.sqlite
    .prepare(
      'SELECT expires_at AS expiresAt FROM session WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1',
    )
    .get(ownerId) as { expiresAt: number };
  expect(Date.parse(value.sessionExpiresAt)).toBeLessThanOrEqual(
    persisted.expiresAt,
  );
  expect(Date.parse(value.expiresAt)).toBe(
    Math.min(
      Date.parse(value.serverNow) + offlineLimits.lifetimeMs,
      Date.parse(value.sessionExpiresAt),
    ),
  );
});
it('post-read revocation refuses photo bytes and expired sessions cannot obtain identity', async () => {
  const snapshot = await (await snapshotGET(request(ownerHeaders))).json();
  const photo = snapshot.photos.items[0];
  vi.spyOn(images, 'readImage').mockImplementation(async () => {
    database.sqlite
      .prepare('DELETE FROM session WHERE user_id = ?')
      .run(ownerId);
    return Buffer.from('synthetic-image');
  });
  expect(
    (
      await photoGET(
        new Request('http://localhost' + photo.downloadUrl, {
          headers: ownerHeaders,
        }),
        { params: Promise.resolve({ opaque: photo.id }) },
      )
    ).status,
  ).toBe(401);
  ownerHeaders = await login(ownerId);
  database.sqlite
    .prepare('UPDATE session SET expires_at = 0 WHERE user_id = ?')
    .run(ownerId);
  expect((await identityGET(request(ownerHeaders, 'identity'))).status).toBe(
    401,
  );
});
