import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { fileTokenStore } from '@/server/yazio/token-store';

function addOwner(db: ReturnType<typeof openDatabase>['db']) {
  db.insert(user)
    .values({
      id: 'synthetic-owner',
      role: 'OWNER',
      name: 'Synthetic owner',
      email: 'synthetic@example.test',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    .run();
}
const steps = { source: 'yazio' as const, date: '2026-10-12', steps: 0 };
const observedAt = '2026-10-12T12:00:00Z';
const period = { from: '2026-10-12', to: '2026-10-12' };
test('fresh migration creates eleven entries, health constraints and an idempotent schema', () => {
  const { db, sqlite } = openDatabase('file::memory:');
  try {
    migrate(db, { migrationsFolder: './drizzle' });
    addOwner(db);
    const repo = yazioHealthRepository(db);
    repo.upsert(
      'synthetic-owner',
      { weights: [], dailySteps: [steps] },
      observedAt,
    );
    migrate(db, { migrationsFolder: './drizzle' });
    expect(
      sqlite
        .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
        .get(),
    ).toEqual({ count: 11 });
    expect(repo.steps('synthetic-owner', period)).toMatchObject([{ steps: 0 }]);
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'yazio_weight_owner_date_idx'",
        )
        .get(),
    ).toEqual({ name: 'yazio_weight_owner_date_idx' });
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES ('missing','2026-10-12',0,?)",
        )
        .run(observedAt),
    ).toThrow();
    expect(() =>
      sqlite.prepare('UPDATE yazio_daily_steps SET steps = 1.5').run(),
    ).toThrow();
    expect(sqlite.pragma('integrity_check')).toEqual([
      { integrity_check: 'ok' },
    ]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test('six-to-current migration preserves local records and encrypted files across repeated upgrade', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'yazio-health-upgrade-'));
  const historical = join(directory, 'historical');
  mkdirSync(join(historical, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync('./drizzle/meta/_journal.json', 'utf8'),
  ) as { entries: { tag: string }[] };
  const historicalJournal = {
    ...journal,
    entries: journal.entries.slice(0, 6),
  };
  writeFileSync(
    join(historical, 'meta/_journal.json'),
    JSON.stringify(historicalJournal),
  );
  for (const entry of historicalJournal.entries)
    copyFileSync(
      join('./drizzle', entry.tag + '.sql'),
      join(historical, entry.tag + '.sql'),
    );
  const { db, sqlite } = openDatabase(
    'file:' + join(directory, 'synthetic.sqlite'),
  );
  try {
    migrate(db, { migrationsFolder: historical });
    expect(
      sqlite
        .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
        .get(),
    ).toEqual({ count: 6 });
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'yazio_daily_steps'",
        )
        .get(),
    ).toBeUndefined();
    addOwner(db);
    sqlite
      .prepare(
        'INSERT INTO measurements(id,owner_id,measured_at,values_json,note) VALUES (?,?,?,?,?)',
      )
      .run(
        'synthetic-measurement',
        'synthetic-owner',
        '2026-10-12',
        JSON.stringify([{ metric: 'weight', value: '70', unit: 'kg' }]),
        'synthetic',
      );
    sqlite
      .prepare(
        'INSERT INTO workout_sessions(id,owner_id,data,date,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        'synthetic-workout',
        'synthetic-owner',
        JSON.stringify({ source: 'demo', exercises: [] }),
        '2026-10-12',
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES (?,?,?,?)',
      )
      .run(
        'synthetic-owner',
        '2026-10-12',
        JSON.stringify({ source: 'demo', meals: [] }),
        observedAt,
      );
    const tables = ['measurements', 'workout_sessions', 'nutrition_days'];
    const previous = tables.map((table) =>
      sqlite.prepare('SELECT * FROM ' + table).all(),
    );
    const tokenFile = join(directory, 'synthetic-encrypted-token.json');
    const secret = randomBytes(32).toString('hex');
    const store = fileTokenStore(tokenFile, 'synthetic-owner', secret);
    const token = {
      token_type: 'Bearer',
      access_token: 'synthetic-access-only',
      refresh_token: 'synthetic-refresh-only',
      expires_in: 3600,
      expires_at: 1791800000000,
    };
    await store.load();
    await store.save(token);
    const encryptedBefore = readFileSync(tokenFile);
    expect(encryptedBefore.toString()).not.toContain(token.access_token);
    const photoFile = join(directory, 'synthetic-private-photo.bin');
    const photo = randomBytes(16);
    writeFileSync(photoFile, photo);

    migrate(db, { migrationsFolder: './drizzle' });
    yazioHealthRepository(db).upsert(
      'synthetic-owner',
      { weights: [], dailySteps: [steps] },
      observedAt,
    );
    migrate(db, { migrationsFolder: './drizzle' });
    expect(
      sqlite
        .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
        .get(),
    ).toEqual({ count: 11 });
    expect(
      tables.map((table) => sqlite.prepare('SELECT * FROM ' + table).all()),
    ).toEqual(previous);
    expect(readFileSync(tokenFile)).toEqual(encryptedBefore);
    expect(readFileSync(photoFile)).toEqual(photo);
    expect(
      await fileTokenStore(tokenFile, 'synthetic-owner', secret).load(),
    ).toEqual(token);
    expect(
      yazioHealthRepository(db).steps('synthetic-owner', period),
    ).toMatchObject([{ steps: 0 }]);
    expect(sqlite.pragma('integrity_check')).toEqual([
      { integrity_check: 'ok' },
    ]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
