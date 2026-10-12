import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { openDatabase } from '@/server/db/connection';
import { diaryDateSchema } from '@/contracts/nutrition';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
if (process.env.DATABASE_URL !== 'file:./.data/e2e.sqlite')
  throw new Error('Only isolated E2E database');
const today = diaryDateSchema.parse(process.argv[2]);
const mode = process.argv[3];
const db = openDatabase(process.env.DATABASE_URL);
const backupFile = '.data/overview-fixture-backup.json';
const tables = [
  'nutrition_days',
  'measurements',
  'workout_plans',
  'workout_sessions',
  'trainer_access',
];
try {
  const owner = db.sqlite
    .prepare(
      "SELECT id FROM user WHERE email='owner@example.test' AND role='OWNER'",
    )
    .get() as { id: string } | undefined;
  if (!owner) throw new Error('Synthetic owner required');
  if (mode === 'backup') {
    const rows = Object.fromEntries(
      tables.map((table) => [
        table,
        db.sqlite
          .prepare(`SELECT * FROM ${table} WHERE owner_id=?`)
          .all(owner.id),
      ]),
    );
    writeFileSync(backupFile, JSON.stringify(rows), { mode: 0o600 });
  } else if (mode === 'restore') {
    if (existsSync(backupFile)) {
      const rows = JSON.parse(readFileSync(backupFile, 'utf8')) as Record<
        string,
        Array<Record<string, unknown>>
      >;
      db.sqlite.transaction(() => {
        for (const table of tables) {
          db.sqlite
            .prepare(`DELETE FROM ${table} WHERE owner_id=?`)
            .run(owner.id);
          for (const row of rows[table] ?? []) {
            const columns = Object.keys(row);
            db.sqlite
              .prepare(
                `INSERT INTO ${table}(${columns.map((column) => `"${column}"`).join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
              )
              .run(...Object.values(row));
          }
        }
      })();
      unlinkSync(backupFile);
    }
  } else {
    db.sqlite
      .prepare('DELETE FROM nutrition_days WHERE owner_id=?')
      .run(owner.id);
    if (mode === 'empty') {
      for (const table of ['workout_sessions', 'workout_plans', 'measurements'])
        db.sqlite
          .prepare(`DELETE FROM ${table} WHERE owner_id=?`)
          .run(owner.id);
    }
    if (mode !== 'empty') {
      const add = (
        date: string,
        calories: string | null,
        known: string | null,
      ) => {
        const totals = {
          calories,
          protein: calories === null ? null : '10.125',
          fat: null,
          carbs: '20',
        };
        const snapshot = {
          date,
          fetchedAt: new Date().toISOString(),
          meals: ['breakfast', 'lunch', 'dinner', 'snack'].map((kind) => ({
            kind,
            entries: [],
            totals,
            knownTotals: totals,
            officialTotals: totals,
            delta: { calories: null, protein: null, fat: null, carbs: null },
          })),
          totals,
          knownTotals: { ...totals, calories: known },
          officialTotals: {
            calories: null,
            protein: null,
            fat: null,
            carbs: null,
          },
          delta: { calories: null, protein: null, fat: null, carbs: null },
        };
        db.sqlite
          .prepare(
            'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
          )
          .run(owner.id, date, JSON.stringify(snapshot), snapshot.fetchedAt);
      };
      add(today, mode === 'partial' ? null : '100.125', '100.125');
      if (mode === 'populated') add(shiftDate(today, -1), '200.375', '200.375');
    }
  }
} finally {
  db.sqlite.close();
}
