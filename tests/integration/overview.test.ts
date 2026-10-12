import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
vi.mock('@/server/jobs/nutrition-scheduler', () => ({
  getNutritionSchedule: () => ({
    running: false,
    lastSuccess: null,
    lastError: null,
  }),
}));
const { getOverview } = await import('@/server/overview');
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
});
afterAll(() => database.sqlite.close());
it('keeps missing nutrition null, limits weight trend and does not leak sync to a granted trainer', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const empty = await getOverview(
    new Headers(),
    'America/Los_Angeles',
    new Date('2026-10-12T00:30:00Z'),
  );
  expect(empty.today).toBe('2026-10-11');
  expect(empty.nutrition.today).toBeNull();
  expect(empty.nutrition.meanCalories).toBeNull();
  expect(empty.weight.points).toHaveLength(30);
  expect(empty.sync).toBeDefined();
  database.sqlite
    .prepare(
      'INSERT INTO measurements(id,owner_id,measured_at,values_json) VALUES(?,?,?,?)',
    )
    .run(
      'old',
      'owner',
      '2020-01-01',
      JSON.stringify([{ metric: 'weight', value: '80.125', unit: 'kg' }]),
    );
  const latest = await getOverview(
    new Headers(),
    'UTC',
    new Date('2026-10-12T12:00:00Z'),
  );
  expect(latest.weight.latest?.value).toBe('80.125');
  expect(latest.weight.points.every((point) => point.value === null)).toBe(
    true,
  );
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  await expect(getOverview(new Headers(), 'UTC')).rejects.toMatchObject({
    status: 403,
  });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  const granted = await getOverview(new Headers(), 'UTC');
  expect(granted).not.toHaveProperty('sync');
  expect(granted.weight.latest?.value).toBe('80.125');
  database.sqlite.prepare('DELETE FROM trainer_access').run();
  await expect(getOverview(new Headers(), 'UTC')).rejects.toMatchObject({
    status: 403,
  });
  state.session = null;
  await expect(getOverview(new Headers(), 'UTC')).rejects.toMatchObject({
    status: 401,
  });
});

it('preserves exact nutrition coverage and excludes finished planned workouts', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const add = (date: string, calories: string | null, known: string | null) => {
    const totals = { calories, protein: null, fat: null, carbs: null };
    const delta = { calories: null, protein: null, fat: null, carbs: null };
    const snapshot = {
      date,
      fetchedAt: '2026-10-12T12:00:00Z',
      meals: ['breakfast', 'lunch', 'dinner', 'snack'].map((kind) => ({
        kind,
        entries: [],
        totals,
        knownTotals: totals,
        officialTotals: totals,
        delta,
      })),
      totals,
      knownTotals: { ...totals, calories: known },
      officialTotals: totals,
      delta,
    };
    database.sqlite
      .prepare(
        'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
      )
      .run('owner', date, JSON.stringify(snapshot), snapshot.fetchedAt);
  };
  add('2026-10-12', '100.125', '100.125');
  add('2026-10-11', '200.375', '200.375');
  add('2026-10-10', null, '50');
  const { workoutRepository } = await import('@/server/workouts/repository');
  const repo = workoutRepository(database.db);
  const exercises = [{ name: 'Exercise', sets: [{ reps: 8, weightKg: 20 }] }];
  const plan = repo.createPlan('owner', {
    title: 'Plan',
    description: '',
    startsOn: '2026-10-12',
    endsOn: '2026-10-13',
    workouts: [
      { id: 'done', title: 'Finished', date: '2026-10-12', exercises },
      { id: 'next', title: 'Next', date: '2026-10-13', exercises },
    ],
  });
  repo.createSession('owner', {
    planId: plan.id,
    plannedWorkoutId: 'done',
    date: '2026-10-12',
    title: 'Completed',
    status: 'completed',
    exercises,
    note: '',
  });
  const data = await getOverview(
    new Headers(),
    'UTC',
    new Date('2026-10-12T12:00:00Z'),
  );
  expect(data.nutrition.today?.calories).toBe('100.125');
  expect(data.nutrition.meanCalories).toBe('150.25');
  expect(data.nutrition.recordedDays).toBe(3);
  expect(data.nutrition.confirmedDays).toBe(2);
  expect(data.nutrition.partialDays).toBe(1);
  expect(data.workouts.planned).toEqual({ title: 'Next', date: '2026-10-13' });
  expect(data.workouts.completed).toEqual({
    title: 'Completed',
    date: '2026-10-12',
  });
});
