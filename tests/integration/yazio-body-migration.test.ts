import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
it('migrates a synthetic ten-migration database to twelve preserving existing records and FK integrity', () => {
  const root = mkdtempSync(join(tmpdir(), 'yazio-body-migration-'));
  mkdirSync(join(root, 'meta'));
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 10);
  writeFileSync(join(root, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(`drizzle/${entry.tag}.sql`, join(root, `${entry.tag}.sql`));
  const database = openDatabase('file:' + join(root, 'existing.sqlite'));
  try {
    migrate(database.db, { migrationsFolder: root });
    expect(
      database.sqlite
        .prepare('SELECT count(*) as n FROM __drizzle_migrations')
        .get(),
    ).toEqual({ n: 10 });
    database.sqlite
      .prepare(
        'INSERT INTO user(id,name,email,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('owner', 'Synthetic', 'migration@example.test', 'OWNER', 1, 1);
    database.sqlite
      .prepare(
        'INSERT INTO measurements(id,owner_id,measured_at,values_json,note) VALUES(?,?,?,?,?)',
      )
      .run(
        'old',
        'owner',
        '2026-10-12',
        '[{"metric":"neck","value":"40","unit":"cm"}]',
        'preserve history',
      );
    const before = database.sqlite.prepare('SELECT * FROM measurements').all();
    migrate(database.db, { migrationsFolder: './drizzle' });
    expect(
      database.sqlite
        .prepare('SELECT count(*) as n FROM __drizzle_migrations')
        .get(),
    ).toEqual({ n: 12 });
    expect(database.sqlite.prepare('SELECT * FROM measurements').all()).toEqual(
      before,
    );
    expect(
      database.sqlite.prepare('SELECT * FROM yazio_body_outbox').all(),
    ).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check')).toEqual([
      { integrity_check: 'ok' },
    ]);
  } finally {
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  }
  const fresh = openDatabase('file::memory:');
  try {
    migrate(fresh.db, { migrationsFolder: './drizzle' });
    expect(
      fresh.sqlite
        .prepare('SELECT count(*) as n FROM __drizzle_migrations')
        .get(),
    ).toEqual({ n: 12 });
    expect(fresh.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    fresh.sqlite.close();
  }
});
