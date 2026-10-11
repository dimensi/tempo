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
const repository = {
  day: vi.fn(() => null),
  list: vi.fn(() => []),
  photos: vi.fn(() => []),
  listPhotos: vi.fn(() => []),
  photo: vi.fn((): { storageKey: string; mime: string } | null => null),
};
vi.mock('@/server/nutrition/repository', () => ({
  nutritionRepository: () => repository,
}));
const imageRead = vi.hoisted(() => ({
  read: vi.fn(async () => Buffer.from('synthetic')),
}));
vi.mock('@/server/nutrition/images', () => ({ readImage: imageRead.read }));
const { getNutritionDay, listNutritionDays, listMealPhotos, readMealPhoto } =
  await import('@/server/nutrition');
const { nutritionAccess } = await import('@/server/nutrition/access');
const { sameOrigin } = await import('@/server/nutrition/http');
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
it('guards every public reader, enforces grants/revocation, and denies trainer writes', async () => {
  const headers = new Headers();
  for (const operation of [
    () => getNutritionDay(headers, 'owner', '2026-01-01'),
    () =>
      listNutritionDays(headers, 'owner', {
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    () =>
      listMealPhotos(headers, 'owner', {
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    () => readMealPhoto(headers, 'owner', 'photo'),
  ])
    await expect(operation()).rejects.toMatchObject({ status: 401 });
  expect(repository.day).not.toHaveBeenCalled();
  expect(repository.photo).not.toHaveBeenCalled();
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  await expect(
    getNutritionDay(headers, 'another-owner', '2026-01-01'),
  ).rejects.toMatchObject({ status: 403 });
  expect(await getNutritionDay(headers, 'owner', '2026-01-01')).toBeNull();
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  await expect(
    listMealPhotos(headers, 'owner', { from: '2026-01-01', to: '2026-01-01' }),
  ).rejects.toMatchObject({ status: 403 });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  expect(
    await listMealPhotos(headers, 'owner', {
      from: '2026-01-01',
      to: '2026-01-01',
    }),
  ).toEqual([]);
  await expect(
    nutritionAccess(headers, 'owner', 'nutrition:write'),
  ).rejects.toMatchObject({ status: 403 });
  database.db.delete(trainerAccess).run();
  await expect(
    getNutritionDay(headers, 'owner', '2026-01-01'),
  ).rejects.toMatchObject({ status: 403 });
});
it('does not return bytes after trainer grant is revoked during file read', async () => {
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  repository.photo.mockReturnValue({
    storageKey: 'a'.repeat(64),
    mime: 'image/jpeg',
  });
  imageRead.read.mockImplementationOnce(async () => {
    database.db.delete(trainerAccess).run();
    return Buffer.from('synthetic');
  });
  await expect(
    readMealPhoto(new Headers(), 'owner', 'photo'),
  ).rejects.toMatchObject({ status: 403 });
});
it('requires an explicit matching origin for mutations', () => {
  expect(() =>
    sameOrigin(
      new Request('http://localhost:3000/api/yazio/token', { method: 'POST' }),
    ),
  ).toThrow();
  expect(() =>
    sameOrigin(
      new Request('http://localhost:3000/api/yazio/token', {
        method: 'POST',
        headers: { Origin: 'https://evil.test' },
      }),
    ),
  ).toThrow();
  expect(() =>
    sameOrigin(
      new Request('http://localhost:3000/api/yazio/token', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      }),
    ),
  ).not.toThrow();
});
