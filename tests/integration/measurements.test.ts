import { vi, it, expect } from 'vitest';
vi.mock('server-only', () => ({}));
import { openDatabase } from '@/server/db/connection';
import { measurementRepository } from '@/server/measurements/repository';
it('persists partial measurements and scopes all CRUD by owner', () => {
  const { db, sqlite } = openDatabase('file::memory:');
  sqlite.exec(
    'CREATE TABLE measurements (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, measured_at TEXT NOT NULL, values_json TEXT NOT NULL, note TEXT)',
  );
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
