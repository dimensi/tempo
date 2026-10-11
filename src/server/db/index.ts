import 'server-only';
import { openDatabase } from './connection';
import { readServerEnv } from '../env';
const globalDb = globalThis as unknown as {
  database?: ReturnType<typeof openDatabase>;
};
export function getDatabase() {
  return (globalDb.database ??= openDatabase(readServerEnv().DATABASE_URL));
}
