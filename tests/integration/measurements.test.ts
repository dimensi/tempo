import { vi, it, expect } from 'vitest';
vi.mock('server-only', () => ({}));
import { openDatabase } from '@/server/db/connection';
import { measurementRepository } from '@/server/measurements/repository';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { user } from '@/server/db/schema';
it('persists partial measurements and scopes all CRUD by owner', () => {
  const { db, sqlite } = openDatabase('file::memory:');
  migrate(db, { migrationsFolder: './drizzle' });
  db.insert(user)
    .values({
      id: 'owner',
      role: 'OWNER',
      name: 'Synthetic owner',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  try {
    const repo = measurementRepository(db);
    const input = {
      measuredAt: '2026-10-11',
      values: [
        { metric: 'weight' as const, value: '70.125', unit: 'kg' as const },
      ],
      note: null,
    };
    const item = repo.create('owner', input);
    expect(repo.list('other')).toEqual([]);
    expect(repo.find('other', item.id)).toBeUndefined();
    expect(
      repo.update('other', item.id, { ...input, note: 'hijacked' }),
    ).toBeUndefined();
    expect(repo.remove('other', item.id)).toBeUndefined();
    expect(repo.find('owner', item.id)?.values[0]?.value).toBe('70.125');
    expect(
      repo.update('owner', item.id, { ...input, note: 'updated' })?.note,
    ).toBe('updated');
    expect(repo.remove('owner', item.id)).toEqual({ id: item.id });
    expect(repo.list('owner')).toEqual([]);
  } finally {
    sqlite.close();
  }
});
