import { expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { measurementRepository } from '@/server/measurements/repository';
vi.mock('server-only', () => ({}));

it('reads only owner-scoped inclusive period rows and projects required weight fields', () => {
  const { db, sqlite } = openDatabase('file::memory:');
  try {
    migrate(db, { migrationsFolder: './drizzle' });
    for (const [id, role] of [
      ['owner', 'OWNER'],
      ['other', 'TRAINER'],
    ] as const)
      db.insert(user)
        .values({
          id,
          role,
          name: id,
          email: `${id}@example.test`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
    const insert = sqlite.prepare(
      'INSERT INTO measurements(id,owner_id,measured_at,values_json,note) VALUES(?,?,?,?,?)',
    );
    const values = [
      { metric: 'weight', value: '72.125', unit: 'kg' },
      { metric: 'waist', value: '80', unit: 'cm' },
    ];
    insert.run(
      'from',
      'owner',
      '2026-10-10',
      JSON.stringify(values),
      'private note',
    );
    insert.run(
      'to',
      'owner',
      '2026-10-12',
      JSON.stringify([values[0]]),
      'private note',
    );
    // Undecodable sentinels prove exclusions happen in SQL, before JSON decoding.
    insert.run('before', 'owner', '2026-10-09', 'not-json', null);
    insert.run('after', 'owner', '2026-10-13', 'not-json', null);
    insert.run('foreign', 'other', '2026-10-11', 'not-json', null);
    const rows = measurementRepository(db).listPeriod('owner', {
      from: '2026-10-10',
      to: '2026-10-12',
    });
    expect(rows).toEqual([
      { measuredAt: '2026-10-10', values },
      { measuredAt: '2026-10-12', values: [values[0]] },
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['measuredAt', 'values']);
  } finally {
    sqlite.close();
  }
});
