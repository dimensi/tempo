import 'dotenv/config';
import { openDatabase } from '../src/server/db/connection';
// Infrastructure only: no real or fictitious nutrition data is persisted.
const { sqlite } = openDatabase(
  process.env.DATABASE_URL ?? 'file:./.data/development.sqlite',
);
try {
  sqlite.prepare('SELECT count(*) FROM user').get();
  console.log('Infrastructure seed ready; create users with auth:create-user');
} finally {
  sqlite.close();
}
