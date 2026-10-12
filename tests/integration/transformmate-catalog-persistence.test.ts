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
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import {
  createCatalogStore,
  type CatalogIdentity,
} from '@/server/transformmate/catalog-store';
import { projectDetail } from '@/server/transformmate/catalog-projection';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
const scope: CatalogIdentity = {
  ownerId: 'owner',
  accountScope: 'account',
  generation: 'persisted-connection',
  locale: 'ru',
};
const at = '2026-10-13T00:00:00.000Z';
function owner(database: ReturnType<typeof openDatabase>) {
  database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic',
      role: 'OWNER',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}
it('migrates fresh and existing synthetic databases without changing existing owner data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-migrations-'));
  try {
    for (const existing of [false, true]) {
      const database = openDatabase(
        `file:${join(directory, String(existing) + '.sqlite')}`,
      );
      try {
        if (existing) {
          const previous = join(directory, 'previous');
          mkdirSync(previous);
          mkdirSync(join(previous, 'meta'));
          const journal = JSON.parse(
            readFileSync('drizzle/meta/_journal.json', 'utf8'),
          );
          journal.entries.pop();
          writeFileSync(
            join(previous, 'meta/_journal.json'),
            JSON.stringify(journal),
          );
          for (const entry of journal.entries)
            copyFileSync(
              `drizzle/${entry.tag}.sql`,
              join(previous, `${entry.tag}.sql`),
            );
          migrate(database.db, { migrationsFolder: previous });
          owner(database);
        }
        migrate(database.db, { migrationsFolder: './drizzle' });
        if (!existing) owner(database);
        expect(
          database.sqlite
            .prepare('SELECT name FROM user WHERE id=?')
            .get('owner'),
        ).toEqual({ name: 'Synthetic' });
        expect(
          database.sqlite.pragma('integrity_check', { simple: true }),
        ).toBe('ok');
        expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
        expect(
          database.sqlite
            .prepare(
              "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'transformmate_catalog_%'",
            )
            .get(),
        ).toEqual({ n: 3 });
        expect(() =>
          database.sqlite
            .prepare(
              'INSERT INTO transformmate_catalog_state (owner_id,account_scope,generation,locale) VALUES (?,?,?,?)',
            )
            .run('missing', 'a', 'g', 'ru'),
        ).toThrow();
        expect(() =>
          database.sqlite
            .prepare(
              'INSERT INTO transformmate_catalog_state (owner_id,account_scope,generation,locale) VALUES (?,?,?,?)',
            )
            .run('owner', 'a', 'g', 'en'),
        ).toThrow();
      } finally {
        database.sqlite.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('persists across restart, isolates accounts/generations, bounds pages and retains aliases after full refresh', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-persist-'));
  const url = `file:${join(directory, 'synthetic.sqlite')}`;
  let database = openDatabase(url);
  try {
    migrate(database.db, { migrationsFolder: './drizzle' });
    owner(database);
    let store = createCatalogStore(database.sqlite);
    store.detail(
      scope,
      projectDetail({
        ...exerciseDetailFixture(),
        other_names: ['Actual alias'],
      }),
      at,
    );
    store.page(
      scope,
      'filtered',
      [{ id: 501, name: 'Selected', metrics: [] }],
      1,
      false,
      at,
    );
    expect(store.records(scope, true)).toEqual([]);
    database.sqlite.close();
    database = openDatabase(url);
    store = createCatalogStore(database.sqlite);
    expect(store.record(scope, 501)?.detail?.other_names).toEqual([
      'Actual alias',
    ]);
    expect(store.query(scope, 'filtered')?.ids).toEqual([501]);
    expect(store.records({ ...scope, accountScope: 'other' })).toEqual([]);
    expect(store.records({ ...scope, generation: 'reconnected' })).toEqual([]);
    store.full(scope, [{ id: 501, name: 'Updated summary', metrics: [] }], at);
    expect(store.records(scope, true)).toHaveLength(1);
    expect(store.record(scope, 501)?.detail?.other_names).toEqual([
      'Actual alias',
    ]);
    for (let index = 0; index < 70; index++)
      store.page(scope, `query-${index}`, [], 0, false, at);
    expect(
      database.sqlite
        .prepare('SELECT count(*) AS n FROM transformmate_catalog_query')
        .get(),
    ).toEqual({ n: 64 });
    database.db.delete(user).run();
    expect(store.records(scope)).toEqual([]);
    expect(store.state(scope)).toBeUndefined();
    expect(store.query(scope, 'filtered')).toBeNull();
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
