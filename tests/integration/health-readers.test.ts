import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hashPassword } from 'better-auth/crypto';
import { openDatabase } from '@/server/db/connection';
import { user, account, trainerAccess } from '@/server/db/schema';
vi.mock('server-only', () => ({}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
import { getAuth } from '@/server/auth';
import * as persistence from '@/server/yazio/health-repository';
import { getStepsSummary, getWeightHistory } from '@/server/health';
import { GET as stepsGET } from '@/app/api/health/steps/route';
import { GET as weightGET } from '@/app/api/health/weight/route';
const range = { from: '2026-10-10', to: '2026-10-12' };
let ownerHeaders: Headers;
let trainerHeaders: Headers;
const grant = () =>
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .onConflictDoNothing()
    .run();
beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'health-test-synthetic-secret-123456789012345',
  );
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
  ] as const) {
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
      .insert(account)
      .values({
        id: `credential-${id}`,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword('Health-test-password-12345'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const response = await getAuth().api.signInEmail({
      body: {
        email: `${id}@example.test`,
        password: 'Health-test-password-12345',
      },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const headers = new Headers({ cookie });
    if (id === 'owner') ownerHeaders = headers;
    else trainerHeaders = headers;
  }
  persistence.yazioHealthRepository().upsert(
    'owner',
    {
      weights: [
        {
          source: 'yazio',
          externalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          providerDate: '2026-10-11 23:30:00',
          measuredDate: '2026-10-11',
          rawValue: '160.125',
          unit: null,
          unitContext: 'lb',
          upstreamSource: 'PRIVATE',
          gateway: 'PRIVATE',
        },
      ],
      dailySteps: [
        { source: 'yazio', date: '2026-10-10', steps: 0 },
        { source: 'yazio', date: '2026-10-12', steps: 1234 },
      ],
    },
    '2026-10-12T12:00:00Z',
  );
  database.sqlite
    .prepare(
      'INSERT INTO measurements(id,owner_id,measured_at,values_json) VALUES(?,?,?,?)',
    )
    .run(
      'manual',
      'owner',
      '2026-10-10',
      JSON.stringify([
        { metric: 'weight', value: '72.125', unit: 'kg' },
        { metric: 'waist', value: '80', unit: 'cm' },
      ]),
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  database.db.delete(trainerAccess).run();
});
afterAll(() => {
  database.sqlite.close();
  vi.unstubAllEnvs();
});
it('uses actual sessions: owner reads safe zero/gap/date/source projections and unknown units', async () => {
  const steps = await getStepsSummary(ownerHeaders, range);
  expect(steps.days).toEqual([
    { date: '2026-10-10', steps: 0, source: 'YAZIO' },
    { date: '2026-10-11', steps: null, source: null },
    { date: '2026-10-12', steps: 1234, source: 'YAZIO' },
  ]);
  expect(steps).toMatchObject({
    observedDays: 2,
    totalSteps: '1234',
    averageSteps: '617',
  });
  const weights = await getWeightHistory(ownerHeaders, range);
  expect(weights.local).toEqual([
    { measuredAt: '2026-10-10', value: '72.125', unit: 'kg', source: 'LOCAL' },
  ]);
  expect(weights.imported).toEqual([
    {
      measuredAt: '2026-10-11',
      rawValue: '160.125',
      unit: null,
      unitStatus: 'UNKNOWN',
      source: 'YAZIO',
    },
  ]);
  expect(JSON.stringify(weights)).not.toMatch(
    /PRIVATE|aaaaaaaa|owner|unitContext|providerDate|waist/,
  );
});
it('denies anonymous and ungranted trainer and honors revocation with the retained session', async () => {
  for (const read of [getStepsSummary, getWeightHistory]) {
    await expect(read(new Headers(), range)).rejects.toMatchObject({
      status: 401,
    });
    await expect(read(trainerHeaders, range)).rejects.toMatchObject({
      status: 403,
    });
    grant();
    await expect(read(trainerHeaders, range)).resolves.toHaveProperty(
      'range',
      range,
    );
    database.db.delete(trainerAccess).run();
    await expect(read(trainerHeaders, range)).rejects.toMatchObject({
      status: 403,
    });
  }
});
it('rechecks actual grants after steps and weight persistence reads', async () => {
  const factory = persistence.yazioHealthRepository;
  for (const [method, read] of [
    ['steps', getStepsSummary],
    ['weights', getWeightHistory],
  ] as const) {
    grant();
    vi.spyOn(persistence, 'yazioHealthRepository').mockImplementation(() => {
      const repo = factory();
      return {
        ...repo,
        [method]: (...args: Parameters<typeof repo.steps>) => {
          const records = repo[method](...args);
          database.db.delete(trainerAccess).run();
          return records;
        },
      };
    });
    await expect(read(trainerHeaders, range)).rejects.toMatchObject({
      status: 403,
    });
    vi.restoreAllMocks();
  }
});
it('returns exact large sums and null for an entirely missing period', async () => {
  persistence.yazioHealthRepository().upsert(
    'owner',
    {
      weights: [],
      dailySteps: ['2026-09-01', '2026-09-02'].map((date) => ({
        source: 'yazio' as const,
        date,
        steps: Number.MAX_SAFE_INTEGER,
      })),
    },
    '2026-10-12T12:00:00Z',
  );
  const large = await getStepsSummary(ownerHeaders, {
    from: '2026-09-01',
    to: '2026-09-02',
  });
  expect(large.totalSteps).toBe('18014398509481982');
  expect(large.averageSteps).toBe('9007199254740991');
  expect(
    await getStepsSummary(ownerHeaders, {
      from: '2026-08-01',
      to: '2026-08-02',
    }),
  ).toMatchObject({ observedDays: 0, totalSteps: null, averageSteps: null });
});
it('retains null imported values and excludes ambiguous dates without guessing', async () => {
  persistence.yazioHealthRepository().upsert(
    'owner',
    {
      weights: [
        {
          source: 'yazio',
          externalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          providerDate: '2026-07-02',
          measuredDate: '2026-07-02',
          rawValue: null,
          unit: null,
          unitContext: 'kg',
          upstreamSource: null,
          gateway: null,
        },
        {
          source: 'yazio',
          externalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          providerDate: '07/02/2026',
          measuredDate: null,
          rawValue: '999',
          unit: null,
          unitContext: 'kg',
          upstreamSource: null,
          gateway: null,
        },
      ],
      dailySteps: [{ source: 'yazio', date: '2026-07-02', steps: null }],
    },
    '2026-10-12T12:00:00Z',
  );
  const period = { from: '2026-07-01', to: '2026-07-03' };
  expect((await getWeightHistory(ownerHeaders, period)).imported).toEqual([
    {
      measuredAt: '2026-07-02',
      rawValue: null,
      unit: null,
      unitStatus: 'UNKNOWN',
      source: 'YAZIO',
    },
  ]);
  expect(await getStepsSummary(ownerHeaders, period)).toMatchObject({
    observedDays: 0,
    totalSteps: null,
    averageSteps: null,
    days: [
      { date: '2026-07-01', steps: null, source: null },
      { date: '2026-07-02', steps: null, source: 'YAZIO' },
      { date: '2026-07-03', steps: null, source: null },
    ],
  });
});
it('API accepts dates only, rejects duplicate/invalid/unbounded input and disables caching', async () => {
  for (const handler of [stepsGET, weightGET]) {
    const request = (query: string, headers = ownerHeaders) =>
      handler(
        new Request(`http://localhost:3000/api/health?${query}`, { headers }),
      );
    const response = await request('from=2026-10-10&to=2026-10-12');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(
      (await request('from=2026-10-10&to=2026-10-12', new Headers())).status,
    ).toBe(401);
    for (const query of [
      'from=2026-10-10&to=2026-10-12&ownerId=foreign',
      'from=2026-10-10&from=2026-10-11&to=2026-10-12',
      'from=2026-02-30&to=2026-10-12',
      'from=2025-01-01&to=2026-10-12',
      'from=2026-10-12&to=2026-10-10',
    ]) {
      const invalid = await request(query);
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get('cache-control')).toBe('no-store');
    }
  }
});
