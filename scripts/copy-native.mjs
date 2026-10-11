import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sqlitePackage = require.resolve('better-sqlite3/package.json');
mkdirSync('native-modules', { recursive: true });
// v13 loads its own N-API binary directly. node-addon-api is compile-time only.
cpSync(dirname(sqlitePackage), 'native-modules/better-sqlite3', {
  recursive: true,
  dereference: true,
});
