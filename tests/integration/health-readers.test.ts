import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hashPassword } from 'better-auth/crypto';
import { openDatabase } from '@/server/db/connection';
import { yazioBodyLinks } from '@/server/db/schema/yazio-body';
import { user, account, trainerAccess } from '@/server/db/schema';
vi.mock('server-only', () => ({}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
import { getAuth } from '@/server/auth';
import * as persistence from '@/server/yazio/health-repository';
import * as measurementPersistence from '@/server/measurements/repository';
import { getStepsSummary, getWeightHistory } from '@/server/health';
import { GET as stepsGET } from '@/app/api/health/steps/route';
import { GET as weightGET } from '@/app/api/health/weight/route';
import { weightTrendChart } from '@/features/measurements/history';
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
it('existing raw weights project kg without conversion or storage changes, and repeated provider UUID remains one row', async () => {
  const repo = persistence.yazioHealthRepository();
  const record = {
    source: 'yazio' as const,
    externalId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    providerDate: '2026-05-01',
    measuredDate: '2026-05-01',
    rawValue: '72.375',
    unit: null,
    unitContext: 'lb',
    upstreamSource: 'PRIVATE_SOURCE',
    gateway: 'PRIVATE_GATEWAY',
  };
  repo.upsert(
    'owner',
    { weights: [record, record], dailySteps: [] },
    '2026-10-12T12:00:00Z',
  );
  repo.upsert(
    'owner',
    {
      weights: [
        { ...record, providerDate: '2026-05-02', measuredDate: '2026-05-02' },
      ],
      dailySteps: [],
    },
    '2026-10-12T12:00:00Z',
  );
  measurementPersistence.measurementRepository().create('owner', {
    measuredAt: '2026-05-02',
    values: [{ metric: 'weight', value: '72.125', unit: 'kg' }],
    note: null,
  });
  const history = await getWeightHistory(ownerHeaders, {
    from: '2026-05-01',
    to: '2026-05-02',
  });
  expect(history.imported).toEqual([
    {
      measuredAt: '2026-05-02',
      rawValue: '72.375',
      unit: 'kg',
      unitStatus: 'OWNER_CONFIRMED',
      source: 'YAZIO',
    },
  ]);
  expect(weightTrendChart(history)).toEqual([
    { date: '2026-05-02', local: 72.125, yazio: 72.375 },
  ]);
  expect(
    database.sqlite
      .prepare(
        'SELECT external_id AS id,raw_value AS value,unit,upstream_source AS source FROM yazio_weight_entries WHERE owner_id = ? AND external_id = ?',
      )
      .all('owner', record.externalId),
  ).toEqual([
    {
      id: record.externalId,
      value: '72.375',
      unit: null,
      source: 'PRIVATE_SOURCE',
    },
  ]);
});
it('uses actual sessions: owner reads safe zero/gap/date/source projections and owner-confirmed kilograms', async () => {
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
      unit: 'kg',
      unitStatus: 'OWNER_CONFIRMED',
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
      unit: 'kg',
      unitStatus: 'OWNER_CONFIRMED',
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
it('bounds local weight reads before decoding, retains both boundary dates and imported null/zero', async () => {
  const period = { from: '2026-06-10', to: '2026-06-12' };
  const insert = database.sqlite.prepare(
    'INSERT INTO measurements(id,owner_id,measured_at,values_json,note) VALUES(?,?,?,?,?)',
  );
  const mixed = [
    { metric: 'weight', value: '70.125', unit: 'kg' },
    { metric: 'waist', value: '80', unit: 'cm' },
  ];
  insert.run(
    'period-from',
    'owner',
    period.from,
    JSON.stringify(mixed),
    'PRIVATE',
  );
  insert.run(
    'period-to',
    'owner',
    period.to,
    JSON.stringify([{ metric: 'weight', value: '71.25', unit: 'kg' }]),
    'PRIVATE',
  );
  insert.run('period-before', 'owner', '2026-06-09', 'not-json', null);
  insert.run('period-after', 'owner', '2026-06-13', 'not-json', null);
  insert.run('period-foreign', 'trainer', '2026-06-11', 'not-json', null);
  persistence.yazioHealthRepository().upsert(
    'owner',
    {
      weights: [
        {
          source: 'yazio',
          externalId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          providerDate: period.from,
          measuredDate: period.from,
          rawValue: '0',
          unit: null,
          unitContext: 'kg',
          upstreamSource: null,
          gateway: null,
        },
        {
          source: 'yazio',
          externalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          providerDate: period.to,
          measuredDate: period.to,
          rawValue: null,
          unit: null,
          unitContext: 'kg',
          upstreamSource: null,
          gateway: null,
        },
      ],
      dailySteps: [],
    },
    '2026-10-12T12:00:00Z',
  );
  const history = await getWeightHistory(ownerHeaders, period);
  expect(history.local).toEqual([
    { measuredAt: period.from, value: '70.125', unit: 'kg', source: 'LOCAL' },
    { measuredAt: period.to, value: '71.25', unit: 'kg', source: 'LOCAL' },
  ]);
  expect(history.imported).toEqual([
    {
      measuredAt: period.from,
      rawValue: '0',
      unit: 'kg',
      unitStatus: 'OWNER_CONFIRMED',
      source: 'YAZIO',
    },
    {
      measuredAt: period.to,
      rawValue: null,
      unit: 'kg',
      unitStatus: 'OWNER_CONFIRMED',
      source: 'YAZIO',
    },
  ]);
  expect(JSON.stringify(history)).not.toMatch(
    /PRIVATE|waist|period-|owner|not-json/,
  );
});
it('rechecks actual trainer access after the bounded local weight read', async () => {
  grant();
  const factory = measurementPersistence.measurementRepository;
  vi.spyOn(measurementPersistence, 'measurementRepository').mockImplementation(
    () => {
      const repository = factory();
      return {
        ...repository,
        listPeriod: (...args) => {
          expect(args).toEqual(['owner', range]);
          const rows = repository.listPeriod(...args);
          database.db.delete(trainerAccess).run();
          return rows;
        },
      };
    },
  );
  await expect(getWeightHistory(trainerHeaders, range)).rejects.toMatchObject({
    status: 403,
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

it('counts a mirrored linked UUID once and retains an unrelated imported weight', async () => {
  const local = measurementPersistence.measurementRepository().create('owner', {
    measuredAt: '2026-10-11',
    values: [{ metric: 'weight', value: '160.125', unit: 'kg' }],
    note: 'Mirrored',
  });
  database.db
    .insert(yazioBodyLinks)
    .values({
      id: 'dedup-link',
      ownerId: 'owner',
      epoch: 1,
      providerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      measurementId: local.id,
      metric: 'weight',
      providerDateTime: '2026-10-11 23:30:00',
      syncedValue: '160.125',
      remoteValue: '160.125',
    })
    .run();
  persistence.yazioHealthRepository().upsert(
    'owner',
    {
      weights: [
        {
          source: 'yazio',
          externalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          providerDate: '2026-10-11',
          measuredDate: '2026-10-11',
          rawValue: '155.25',
          unit: null,
          unitContext: null,
          upstreamSource: null,
          gateway: null,
        },
      ],
      dailySteps: [],
    },
    '2026-10-12T12:00:00Z',
  );
  const history = await getWeightHistory(ownerHeaders, range);
  expect(history.local.filter((row) => row.value === '160.125')).toHaveLength(
    1,
  );
  expect(history.imported.some((row) => row.rawValue === '160.125')).toBe(
    false,
  );
  expect(history.imported.some((row) => row.rawValue === '155.25')).toBe(true);
});
