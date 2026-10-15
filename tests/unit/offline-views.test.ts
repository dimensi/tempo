import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ sqlite: null as Database.Database | null }));
vi.mock('@/server/db', () => ({
  getDatabase: () => ({ sqlite: state.sqlite }),
}));
vi.mock('@/server/transformmate/catalog-store', () => ({
  catalogStore: () => ({ offlineRecords: () => [], state: () => undefined }),
}));
import { readOfflineViews } from '@/server/offline/views';
import { offlineFixture } from '../offline/fixtures';
const now = '2026-10-12T12:00:00.000Z';
beforeEach(() => {
  // Repository unit: a disposable SQL double, no auth server, migrations, files or provider.
  state.sqlite = new Database(':memory:');
  state.sqlite.exec(`
    CREATE TABLE owner_settings(owner_id TEXT,daily_steps_goal INTEGER);
    CREATE TABLE nutrition_days(owner_id TEXT,date TEXT,snapshot TEXT);
    CREATE TABLE measurements(id TEXT,owner_id TEXT,measured_at TEXT,values_json TEXT,note TEXT);
    CREATE TABLE yazio_weight_entries(owner_id TEXT,external_id TEXT,provider_date TEXT,measured_date TEXT,raw_value TEXT);
    CREATE TABLE yazio_body_links(owner_id TEXT,provider_id TEXT,metric TEXT,measurement_id TEXT);
    CREATE TABLE yazio_daily_steps(owner_id TEXT,date TEXT,steps INTEGER,observed_at TEXT);
    CREATE TABLE nutrition_schedule(owner_id TEXT,enabled INTEGER,initial_from TEXT,timezone TEXT,last_success INTEGER);
    CREATE TABLE user(id TEXT,name TEXT);
    CREATE TABLE comments(id TEXT,owner_id TEXT,author_id TEXT,target_type TEXT,target_id TEXT,parent_id TEXT,body TEXT,created_at INTEGER);
    CREATE TABLE workout_plans(id TEXT,owner_id TEXT,data TEXT);
    CREATE TABLE workout_sessions(id TEXT,owner_id TEXT,date TEXT,data TEXT,updated_at TEXT);
    CREATE TABLE workout_videos(id TEXT,owner_id TEXT,session_id TEXT,size INTEGER,state TEXT,created_at INTEGER);
  `);
});
afterEach(() => state.sqlite?.close());
function read(role: 'OWNER' | 'TRAINER' = 'OWNER') {
  return readOfflineViews({
    ownerId: 'owner',
    role,
    from: '2026-09-28',
    to: '2026-10-12',
    accountScope: null,
    connectionId: null,
    transformMateConnected: false,
    key: (purpose, id) => `${purpose}-${id}`,
  });
}
it('projects compact observations, excludes foreign owners and keeps zero distinct from absent data', () => {
  const db = state.sqlite!;
  const day = offlineFixture(Date.parse(now)).diary[0]!;
  for (const owner of ['owner', 'foreign']) {
    db.prepare('INSERT INTO nutrition_days VALUES (?,?,?)').run(
      owner,
      day.date,
      JSON.stringify(day),
    );
    db.prepare('INSERT INTO yazio_daily_steps VALUES (?,?,?,?)').run(
      owner,
      day.date,
      0,
      now,
    );
  }
  db.prepare('INSERT INTO measurements VALUES (?,?,?,?,?)').run(
    'm',
    'owner',
    day.date,
    JSON.stringify([{ metric: 'weight', value: '72.125', unit: 'kg' }]),
    'private note',
  );
  db.prepare('INSERT INTO yazio_weight_entries VALUES (?,?,?,?,?)').run(
    'owner',
    'linked',
    day.date,
    day.date,
    '72.125',
  );
  db.prepare('INSERT INTO yazio_body_links VALUES (?,?,?,?)').run(
    'owner',
    'linked',
    'weight',
    'm',
  );
  db.prepare('INSERT INTO yazio_weight_entries VALUES (?,?,?,?,?)').run(
    'owner',
    'raw',
    day.date,
    day.date,
    null,
  );
  const result = read();
  expect(result.summary?.nutrition).toHaveLength(1);
  expect(result.summary?.nutrition[0]).toMatchObject({
    hasEntries: true,
    totals: { calories: '0', protein: null },
  });
  expect(result.summary?.steps).toEqual([
    { date: day.date, steps: 0, observedAt: now },
  ]);
  expect(result.summary?.weight.imported).toHaveLength(1);
  expect(result.summary?.weight.imported[0]!.rawValue).toBeNull();
  expect(JSON.stringify(result.summary)).not.toContain('private note');
  expect(JSON.stringify(result.summary)).not.toContain('Synthetic breakfast');
});
it('retains recent existing-target comments and exposes no owner settings to a trainer', () => {
  const db = state.sqlite!;
  const day = offlineFixture(Date.parse(now)).diary[0]!;
  db.prepare('INSERT INTO nutrition_days VALUES (?,?,?)').run(
    'owner',
    day.date,
    JSON.stringify(day),
  );
  db.prepare('INSERT INTO user VALUES (?,?)').run('author', 'Coach');
  for (const [id, owner, date] of [
    ['good', 'owner', day.date],
    ['foreign', 'foreign', day.date],
    ['old', 'owner', '2026-08-01'],
    ['missing-target', 'owner', '2026-10-11'],
  ])
    db.prepare('INSERT INTO comments VALUES (?,?,?,?,?,?,?,?)').run(
      id,
      owner,
      'author',
      'nutrition_day',
      date,
      null,
      id,
      Date.parse(now),
    );
  db.prepare('INSERT INTO nutrition_schedule VALUES (?,?,?,?,?)').run(
    'owner',
    1,
    '2026-09-01',
    'Europe/Moscow',
    Date.parse(now),
  );
  const result = read('TRAINER');
  expect(result.settings).toBeNull();
  expect(result.comments.map((row) => row.body)).toEqual(['good']);
  expect(result.comments[0]!.target).toBe('/diary?date=2026-10-12');
  expect(read().settings).toMatchObject({
    timezone: 'Europe/Moscow',
    initialFrom: '2026-09-01',
    automaticSync: true,
  });
});
it('prepares the next plan summary without downloading future detailed history', () => {
  state.sqlite!.prepare('INSERT INTO workout_plans VALUES (?,?,?)').run(
    'p',
    'owner',
    JSON.stringify({
      workouts: [{ id: 'w', date: '2026-11-01', title: 'Next' }],
    }),
  );
  expect(read().summary?.workouts.planned).toEqual({
    date: '2026-11-01',
    title: 'Next',
  });
});

it('orders same-day weights like the online reader so the newest id wins the chart', () => {
  for (const [id, value] of [
    ['a', '71'],
    ['z', '72'],
  ])
    state
      .sqlite!.prepare('INSERT INTO measurements VALUES (?,?,?,?,?)')
      .run(
        id,
        'owner',
        '2026-10-12',
        JSON.stringify([{ metric: 'weight', value, unit: 'kg' }]),
        null,
      );
  const summary = read().summary!;
  expect(summary.weight.local.map((row) => row.value)).toEqual(['71', '72']);
  expect(summary.latestWeight).toEqual({ date: '2026-10-12', value: '72' });
});

it('keeps the existing optional report goal scoped to the owner and safe for trainer reports', () => {
  state
    .sqlite!.prepare('INSERT INTO owner_settings VALUES (?,?)')
    .run('owner', 10000);
  state
    .sqlite!.prepare('INSERT INTO owner_settings VALUES (?,?)')
    .run('foreign', 20000);
  expect(read().summary?.dailyStepsGoal).toBe(10000);
  expect(read('TRAINER').summary?.dailyStepsGoal).toBe(10000);
  expect(read('TRAINER').settings).toBeNull();
});
