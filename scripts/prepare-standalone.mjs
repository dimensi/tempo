import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const destination = '.next/standalone';
mkdirSync(`${destination}/node_modules`, { recursive: true });
// Next tracing does not include the SQLite package needed by operator CLI.
// v13 loads its own N-API binary directly; node-addon-api is compile-time only.
cpSync(
  dirname(require.resolve('better-sqlite3/package.json')),
  `${destination}/node_modules/better-sqlite3`,
  { recursive: true, dereference: true },
);
cpSync('.next/static', `${destination}/.next/static`, { recursive: true });
cpSync('public', `${destination}/public`, { recursive: true });
