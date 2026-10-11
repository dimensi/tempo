# SQLite and migrations

`DATABASE_URL=file:./.data/development.sqlite` resolves relative to the current worktree. Production uses `file:/app/data/nutrition.sqlite`. Independent worktrees must never reference a common absolute development DB path. Tests use temporary files; E2E owns a separate disposable file.

Every connection enables WAL, foreign keys and busy_timeout=5000. Use short writes and never hold a transaction while awaiting YAZIO, PDF or other network work. Keep one application process; WAL is not support for multiple hosts sharing an SQLite file on network storage.

To add a table:

1. Agree the contract, ownerId scope and ownership first.
2. Edit `src/server/db/schema.ts` in a coordinated core change; use owner foreign keys and indexes according to actual queries.
3. Run `pnpm db:generate`; inspect generated SQL and commit SQL plus `drizzle/meta`.
4. Test fresh migration and migration of an existing copy. Apply with `pnpm db:migrate`, never production `push`.
5. Take an online backup before deployment. Do not edit a previously deployed migration or silently rewrite its timestamp.

Container startup applies migrations before serving requests. A failed migration stops startup. Schema/CLI paths are included in the runtime image. `db:seed` verifies readiness and intentionally writes no mock nutrition or default passwords.

## Backups and restore

Run `pnpm db:backup /secure/path/backup.sqlite` locally or `node scripts/backup.mjs /app/data/backup.sqlite` inside the container. The SQLite online backup API includes committed WAL content and produces a consistent separate DB without copying an active raw file. Move it out of the database volume to secure off-host storage. Back up uploads separately and securely; future references may require coordinating upload snapshots with DB backups.

Never copy just a live `.sqlite` while ignoring `.sqlite-wal`. Alternative: stop the app cleanly and copy the complete database state. Do not run destructive checkpoints on a live app as a substitute for backup. Verify a copy with SQLite `PRAGMA integrity_check` and regularly rehearse restore.

To restore, stop the app, preserve current data, replace the DB from the verified snapshot, remove obsolete WAL/SHM sidecars only while the app is stopped, restore node ownership (UID 1000), and restart. Migration code must match the restored database's release. Do not `docker compose down -v` on production. Docker smoke uses its own disposable project and volumes only.
