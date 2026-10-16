import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { normalizeYazioWeight } from '@/server/yazio/health-normalize';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(() => connections.splice(0).forEach(({ sqlite }) => sqlite.close()));
function fixture() {
  const connection = openDatabase('file::memory:');
  connections.push(connection);
  migrate(connection.db, { migrationsFolder: './drizzle' });
  connection.db
    .insert(user)
    .values([
      {
        id: 'owner',
        role: 'OWNER',
        name: 'Synthetic owner',
        email: 'owner@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'other',
        role: 'TRAINER',
        name: 'Synthetic other',
        email: 'other@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    .run();
  return { ...connection, repo: yazioHealthRepository(connection.db) };
}
const period = { from: '2026-10-01', to: '2026-10-12' };
const observed = '2026-10-12T12:00:00Z';
const weight = normalizeYazioWeight(
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    date: '2026-10-01',
    value: 70.125,
    external_id: null,
    source: 'synthetic',
    gateway: null,
  },
  'kg',
)!;
test('upserts deduplicate UUIDs, replace provider date, preserve null/zero, and scope by owner', () => {
  const { repo } = fixture();
  repo.upsert(
    'owner',
    {
      weights: [weight, weight],
      dailySteps: [{ source: 'yazio', date: '2026-10-01', steps: 0 }],
    },
    observed,
  );
  repo.upsert('other', { weights: [weight], dailySteps: [] }, observed);
  expect(repo.weights('owner', period)).toHaveLength(1);
  expect(repo.steps('owner', period)[0]?.steps).toBe(0);
  repo.upsert(
    'owner',
    {
      weights: [
        {
          ...weight,
          providerDate: '2026-10-02',
          measuredDate: '2026-10-02',
          rawValue: '71',
        },
      ],
      dailySteps: [{ source: 'yazio', date: '2026-10-01', steps: null }],
    },
    observed,
  );
  expect(repo.weights('owner', period)).toMatchObject([
    {
      measuredDate: '2026-10-02',
      rawValue: '71',
      unit: null,
      unitContext: 'kg',
    },
  ]);
  expect(repo.weights('other', period)[0]?.rawValue).toBe('70.125');
  expect(repo.weights('missing', period)).toEqual([]);
  expect(repo.steps('owner', period)[0]?.steps).toBeNull();
  repo.upsert('owner', { weights: [], dailySteps: [] }, observed);
  expect(repo.weights('owner', period)).toHaveLength(1);
});
test('invalid batches and failed transactions preserve previous rows', () => {
  const { repo, sqlite } = fixture();
  repo.upsert('owner', { weights: [weight], dailySteps: [] }, observed);
  expect(() =>
    repo.upsert(
      'owner',
      {
        weights: [{ ...weight, rawValue: '99' }],
        dailySteps: [{ source: 'yazio', date: '2026-10-01', steps: -1 }],
      },
      observed,
    ),
  ).toThrow();
  expect(repo.weights('owner', period)[0]?.rawValue).toBe('70.125');
  sqlite.exec(
    "CREATE TRIGGER synthetic_failure BEFORE INSERT ON yazio_daily_steps BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  expect(() =>
    repo.upsert(
      'owner',
      {
        weights: [{ ...weight, rawValue: '99' }],
        dailySteps: [{ source: 'yazio', date: '2026-10-01', steps: 1 }],
      },
      observed,
    ),
  ).toThrow();
  expect(repo.weights('owner', period)[0]?.rawValue).toBe('70.125');
});
test('read periods are valid, ordered, bounded and unknown dates do not enter dated history', () => {
  const { repo } = fixture();
  repo.upsert(
    'owner',
    {
      weights: [
        { ...weight, measuredDate: null, providerDate: '2026-10-01T12:00:00Z' },
      ],
      dailySteps: [],
    },
    observed,
  );
  expect(repo.weights('owner', period)).toEqual([]);
  for (const invalid of [
    { from: '2026-02-30', to: '2026-10-01' },
    { from: '2026-10-12', to: '2026-10-01' },
    { from: '2025-01-01', to: '2026-10-01' },
  ]) {
    expect(() => repo.weights('owner', invalid)).toThrow();
    expect(() => repo.steps('owner', invalid)).toThrow();
  }
});
test('owner deletion cascades and database rejects unsafe step counts and claimed units', () => {
  const { repo, sqlite } = fixture();
  repo.upsert(
    'owner',
    {
      weights: [weight],
      dailySteps: [{ source: 'yazio', date: '2026-10-01', steps: 1 }],
    },
    observed,
  );
  expect(() =>
    sqlite.prepare('UPDATE yazio_daily_steps SET steps = -1').run(),
  ).toThrow();
  expect(() =>
    sqlite.prepare("UPDATE yazio_weight_entries SET unit = 'kg'").run(),
  ).toThrow();
  sqlite.prepare('DELETE FROM user WHERE id = ?').run('owner');
  expect(repo.weights('owner', period)).toEqual([]);
  expect(repo.steps('owner', period)).toEqual([]);
});

test('projects stored provider datetime without history rewrite, guesses, owner leakage or collapsing UUIDs', () => {
  const { repo, sqlite } = fixture();
  const values = [
    '2026-10-07 10:55:11',
    '2026-10-07 10:55:43',
    '2026-10-12 23:59:59',
    '2026-10-07T10:55:43Z',
    '2026-10-07 24:00:00',
    '2026-02-30 10:00:00',
  ];
  const rows = values.map((providerDate, index) => ({
    ...weight,
    externalId: `a1111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    providerDate,
    measuredDate: null,
    rawValue: '103.30000305175781',
  }));
  repo.upsert('owner', { weights: rows, dailySteps: [] }, observed);
  repo.upsert('other', { weights: [rows[0]!], dailySteps: [] }, observed);
  const before = sqlite
    .prepare('SELECT * FROM yazio_weight_entries ORDER BY owner_id,external_id')
    .all();
  expect(repo.weights('owner', period).map((row) => row.measuredDate)).toEqual([
    '2026-10-07',
    '2026-10-07',
    '2026-10-12',
  ]);
  expect(repo.weights('owner', period)).toHaveLength(3);
  expect(repo.weights('other', period)).toHaveLength(1);
  expect(
    repo
      .weights('owner', period)
      .map((row) => row.measuredDate)
      .sort(),
  ).toEqual(['2026-10-07', '2026-10-07', '2026-10-12']);
  expect(
    sqlite
      .prepare(
        'SELECT * FROM yazio_weight_entries ORDER BY owner_id,external_id',
      )
      .all(),
  ).toEqual(before);
  expect(
    sqlite.prepare('SELECT count(*) AS n FROM measurements').get(),
  ).toEqual({ n: 0 });
  expect(
    sqlite.prepare('SELECT count(*) AS n FROM yazio_body_outbox').get(),
  ).toEqual({ n: 0 });
});
