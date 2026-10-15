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
it('preserves historical report files, periods and permissions when upgrading an existing database', () => {
  const root = mkdtempSync(join(tmpdir(), 'medical-report-migration-'));
  mkdirSync(join(root, 'meta'));
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 13);
  writeFileSync(join(root, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(`drizzle/${entry.tag}.sql`, join(root, `${entry.tag}.sql`));
  const database = openDatabase('file:' + join(root, 'existing.sqlite'));
  try {
    migrate(database.db, { migrationsFolder: root });
    database.sqlite
      .prepare(
        'INSERT INTO user(id,name,email,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('owner', 'Synthetic', 'migration@example.test', 'OWNER', 1, 1);
    database.sqlite
      .prepare(
        'INSERT INTO medical_report_exports(id,owner_id,created_by,marker_ids_json,date_from,date_to,status,storage_key,filename,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'saved',
        'owner',
        'owner',
        '["alt"]',
        '2026-01-01',
        '2026-09-22',
        'ready',
        'private/immutable.pdf',
        'Снимок.pdf',
        1234,
        1,
      );
    migrate(database.db, { migrationsFolder: 'drizzle' });
    migrate(database.db, { migrationsFolder: 'drizzle' });
    const row = database.sqlite
      .prepare('SELECT * FROM medical_report_exports')
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      id: 'saved',
      owner_id: 'owner',
      marker_ids_json: '["alt"]',
      storage_key: 'private/immutable.pdf',
      filename: 'Снимок.pdf',
      size_bytes: 1234,
      date_keys_json: null,
    });
    expect(JSON.parse(row.historical_period_json as string)).toEqual({
      from: '2026-01-01',
      to: '2026-09-22',
    });
    expect(row).not.toHaveProperty('date_from');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check')).toEqual([
      { integrity_check: 'ok' },
    ]);
  } finally {
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  }
});
