import 'dotenv/config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '../src/server/db/connection';
const { db, sqlite } = openDatabase(
  process.env.DATABASE_URL ?? 'file:./.data/development.sqlite',
);
try {
  migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied');
} finally {
  sqlite.close();
}
