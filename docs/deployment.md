# Deployment and operator guide

## Current preview

The coordinator confirmed the initial verified preview revision `b8b8a1cd154063b713db417a7ab2c2d3d9388a8c` at [nutrition.dimensi.dev](https://nutrition.dimensi.dev). This is a historical verification point, not the current latest after subsequent upgrades. Record the exact deployed revision and image ID/digest for each release; later main commits require explicit deployment. The live YAZIO token is unset; synthetic upstream tests and real authentication/grant/revocation tests do not establish live account synchronization.

The home-server stack is `/opt/compose/yazio-dashboard`, Compose project `nutrition`, with `compose.yaml`, server-local `compose.home.yaml` and `runtime.env`:

```sh
cd /opt/compose/yazio-dashboard
docker compose -p nutrition -f compose.yaml -f compose.home.yaml --env-file runtime.env ps
docker compose -p nutrition -f compose.yaml -f compose.home.yaml --env-file runtime.env logs --tail=100 app
```

The home override removes the host port and joins existing external network `web` with alias `nutrition`. The approved Caddy route forwards public HTTPS traffic to `nutrition:3000`. Base Compose alone binds loopback port 3000; it does not describe deployed home routing. Preserve the override and routing; no new Tunnel or public app port is needed.

`BETTER_AUTH_URL` matches the public HTTPS origin for Secure cookies and trusted-origin checks. `runtime.env` stays outside Git with mode 0600; the operator manages secrets and the eventual persistent `YAZIO_TOKEN_FILE`. The user approved /app/data/yazio-token.json; the coordinator activated the encrypted store in preview revision a36fd75775d1033f611864f9ef3816046ae96d75. Live token state is unknown unless the human verifies it; agents do not log in to YAZIO. After approved setup and deployment, the OWNER submits their own YAZIO email/password in `/settings#connection` and connects with the encrypted-storage description beside the button; a separate app checkbox is not required. JSON import is an advanced fallback. Passwords are not stored; the SDK exchanges/refreshed tokens are saved only in version-1 AES-256-GCM envelopes. The key is derived with HKDF from the existing `BETTER_AUTH_SECRET` and owner context, without a new persistent key. Keep `DEMO_MODE=false`. Never include tokens or personal data in logs or review artifacts.

The approved active path is `/app/data/yazio-token.json`, private to node in the database volume, outside public/uploads; activation was performed separately by the coordinator. Atomic connection files use mode 0600. Preserve the same existing `BETTER_AUTH_SECRET` and owner ID across restart/restore. Legacy plaintext files are rejected; an explicitly approved migration or reconnection is required. Secret rotation also requires an explicit migration/reconnect. The UI explains disabled fields while the operator setting is absent. Confirmed disconnect removes the stored token pair using an encrypted tombstone and retains diary/photos.

## Runtime and owner bootstrap

The image runs as non-root node and applies versioned migrations before serving. It includes standalone Next.js, bundled operator CLI, SQLite, the vendored SDK, Chromium matched to locked Playwright, and DejaVu font. `/api/health` reads the DB. PDF product reports are merged in main alongside browser/font readiness. Verify availability against the actual deployed release.

Volumes `database` and `uploads` survive recreation. Use local disk, one Next.js process, WAL and a 5s busy timeout. Photos are private and served through owner-scoped authorization. Bind mounts require UID 1000 ownership and equivalent access controls.

The first owner is created by the user on the server:

```sh
bash /opt/compose/yazio-dashboard/bootstrap-owner.sh
```

The coordinator confirmed that the user has already created the first OWNER. Bootstrap is for a new empty stack, not a repeat setup step. The server-local helper prompts for a password with hidden input; the agent does not choose or collect it. Open registration is disabled. The owner then invites trainers and grants/revokes access through `/settings/trainers`. Other installations can use bundled `node scripts/create-user.mjs` with the documented `CREATE_USER_*` variables without logging or committing the password.

## Release validation

Record the exact Git revision and image ID/digest, retain the previous release image, preserve server-local configuration and volumes, and create a verified backup before upgrading. Build the reviewed revision and recreate with the same Compose project/files/environment. A local `ghcr.io/dimensi/yazio-dashboard:latest` tag does not prove registry publication; a mutable tag is insufficient for rollback.

Verify migrations, health, login/logout and owner/trainer feature access through the real HTTPS hostname. Live YAZIO sync requires a separate user acceptance check after approved store setup and the user's own account submission; synthetic tests do not establish live connectivity.

For disposable image validation, build `docker build -t nutrition-foundation .`, then run `bash scripts/docker-smoke.sh`. Host tools `pdfinfo`, `pdffonts` and `pdftotext` are required. The script owns a separate `nutrition-smoke` project/volumes and verifies owner CLI, Secure cookies, restart persistence, online backup/restore, persistent uploads and synthetic Cyrillic PDF rendering with embedded fonts. Its volume cleanup must never target production.

## Consistent backup and rollback

Use SQLite online backup, which includes committed WAL state, rather than copying a live `.sqlite` alone:

```sh
docker compose -p nutrition -f compose.yaml -f compose.home.yaml --env-file runtime.env exec -T app node scripts/backup.mjs /app/data/operator-backup.sqlite
```

Export the backup from the volume to protected off-host storage. Verify `PRAGMA integrity_check` and expected records. SQLite online backup does not include the encrypted connection file. If configured, copy that file with mode 0600 into the protected backup set alongside DB/uploads, preserve the existing auth secret in the protected configuration backup, and retain owner identity. Encrypted file and key/configuration must be restored together. Never export decrypted tokens. See the [database guide](architecture/database.md).

An online DB backup and separate live upload/token copies are not a cross-resource atomic snapshot. For a matching backup set, quiesce all writers and wait for in-flight sync/photo/connection work, take the online DB backup and archive uploads plus the optional encrypted connection file/configuration before reopening writes. Stopping the app for the backup window is the simplest procedure; the bundled backup CLI can run in a one-off container against the same stopped stack volumes. Record revision, image digest and backup time. Validate referenced photos and rehearse restore on disposable volumes.

For rollback, stop the app, preserve the current DB/uploads, and choose the saved release image. If the schema is incompatible, restore that release's matching verified DB/upload backup while stopped, preserve ownership and configuration, then restart and validate health/authentication/photos. Remove obsolete WAL/SHM files only while the database is closed. Older images do not reverse migrations. Retain volumes and release images; never use `down -v` on the production project.

## Hourly refresh activation

The approved encrypted path `/app/data/yazio-token.json` is already active from coordinator deployment `a36fd75775d1033f611864f9ef3816046ae96d75`. The existing OWNER needs no bootstrap. Configuration approval/history is distinct from live verification; whether the human has supplied a real token is unknown here.

[Nutrition scheduler](nutrition-scheduler.md) describes the production-only runtime timer and durable lease. `ENABLE_NUTRITION_SCHEDULER` defaults to false; keep it disabled until connect/import/disconnect hooks, common manual-sync service, status UI and exact-head checks are integrated. The coordinator can then explicitly deploy and verify the true flag. Registration alone proves no live account synchronization; observe a real user's accepted connection separately. Hourly work runs on the server and refreshes the last seven dates in the saved timezone, including today. Selected historical data is loaded manually. Restart recovery, sanitized failure state and bounded retries are persisted; no separate cron/worker/key is installed.

Connect/import starts selected-history backfill within the server handler after encrypted save. Closing the browser does not cancel an initiated job; process restart recovery remains as described in the scheduler guide. Hourly refresh uses the saved initial history date as a lower bound within the last seven local dates. The account card displays only safe verified SDK metadata or a neutral YAZIO fallback, never the app OWNER profile.
