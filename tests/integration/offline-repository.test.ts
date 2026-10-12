import { expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { offlineRepository } from '@/server/offline/repository';
import { syntheticDay } from '../unit/reports/fixtures';
vi.mock('server-only', () => ({}));
function fixture() {
  const database = openDatabase('file::memory:');
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['other', 'TRAINER'],
  ] as const)
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
  return { ...database, repo: offlineRepository(database) };
}
test('SQL scopes owner and period; N+1 row overflow returns an error instead of truncating', () => {
  const { sqlite, repo } = fixture();
  try {
    const insert = sqlite.prepare(
      'INSERT INTO measurements(id,owner_id,measured_at,values_json) VALUES (?,?,?,?)',
    );
    const values = JSON.stringify([
      { metric: 'weight', value: '70', unit: 'kg' },
    ]);
    sqlite.transaction(() => {
      for (let i = 0; i < 1001; i++)
        insert.run('row-' + i, 'owner', '2026-10-01', values);
      insert.run('included', 'owner', '2026-10-12', values);
      insert.run('other-owner', 'other', '2026-10-12', values);
    })();
    expect(
      repo
        .read('owner', '2026-10-12', '2026-10-12')
        .measurements.map((item) => item.id),
    ).toEqual(['included']);
    expect(() => repo.read('owner', '2026-10-01', '2026-10-12')).toThrowError(
      expect.objectContaining({ status: 413, code: 'OFFLINE_LIMIT_EXCEEDED' }),
    );
    expect(
      sqlite.prepare('SELECT count(*) AS count FROM measurements').get(),
    ).toEqual({ count: 1003 });
  } finally {
    sqlite.close();
  }
});
test('oversized per-row JSON and combined raw payload budget fail without partial results', () => {
  const { sqlite, repo } = fixture();
  try {
    const insert = sqlite.prepare(
      'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES (?,?,?,?)',
    );
    insert.run(
      'owner',
      '2026-10-12',
      'x'.repeat(2 * 1024 * 1024 + 1),
      '2026-10-12T00:00:00Z',
    );
    expect(() => repo.read('owner', '2026-10-12', '2026-10-12')).toThrowError(
      expect.objectContaining({ status: 413 }),
    );
    sqlite.prepare('DELETE FROM nutrition_days').run();
    for (const date of ['2026-10-10', '2026-10-11', '2026-10-12'])
      insert.run(
        'owner',
        date,
        JSON.stringify({
          ...syntheticDay(date),
          ignoredPadding: 'x'.repeat(1500000),
        }),
        '2026-10-12T00:00:00Z',
      );
    expect(() => repo.read('owner', '2026-10-10', '2026-10-12')).toThrowError(
      expect.objectContaining({ status: 413, code: 'OFFLINE_LIMIT_EXCEEDED' }),
    );
  } finally {
    sqlite.close();
  }
});
