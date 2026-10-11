# Deployment and operator guide

## Current preview

The coordinator confirmed preview revision `b8b8a1cd154063b713db417a7ab2c2d3d9388a8c` at [nutrition.dimensi.dev](https://nutrition.dimensi.dev). Later main commits require an explicit release. The live YAZIO token is unset; synthetic upstream tests and real authentication/grant/revocation tests do not establish live account synchronization.

The home-server stack is `/opt/compose/yazio-dashboard`, Compose project `nutrition`, with `compose.yaml`, server-local `compose.home.yaml` and `runtime.env`:

```sh
cd /opt/compose/yazio-dashboard
docker compose -p nutrition -f compose.yaml -f compose.home.yaml --env-file runtime.env ps
docker compose -p nutrition -f compose.yaml -f compose.home.yaml --env-file runtime.env logs --tail=100 app
```

The home override removes the host port and joins existing external network `web` with alias `nutrition`. The approved Caddy route forwards public HTTPS traffic to `nutrition:3000`. Base Compose alone binds loopback port 3000; it does not describe deployed home routing. Preserve the override and routing; no new Tunnel or public app port is needed.

`BETTER_AUTH_URL` matches the public HTTPS origin for Secure cookies and trusted-origin checks. `runtime.env` stays outside Git with mode 0600; the operator manages secrets and the eventual persistent `YAZIO_TOKEN_FILE`. Keep `DEMO_MODE=false`. Never include tokens or personal data in logs or review artifacts.

## Runtime and owner bootstrap

The image runs as non-root node and applies versioned migrations before serving. It includes standalone Next.js, bundled operator CLI, SQLite, the vendored SDK, Chromium matched to locked Playwright, and DejaVu font. `/api/health` reads the DB. Browser/font readiness is merged; product PDF reports remain pending PR #11 until its merge and release are verified.

Volumes `database` and `uploads` survive recreation. Use local disk, one Next.js process, WAL and a 5s busy timeout. Photos are private and served through owner-scoped authorization. Bind mounts require UID 1000 ownership and equivalent access controls.

The first owner is created by the user on the server:

```sh
bash /opt/compose/yazio-dashboard/bootstrap-owner.sh
```

The server-local helper prompts for a password with hidden input; the agent does not choose or collect it. Open registration is disabled. The owner then invites trainers and grants/revokes access through `/settings/trainers`. Other installations can use bundled `node scripts/create-user.mjs` with the documented `CREATE_USER_*` variables without logging or committing the password.

## Release validation

Record the exact Git revision and image ID/digest, retain the previous release image, preserve server-local configuration and volumes, and create a verified backup before upgrading. Build the reviewed revision and recreate with the same Compose project/files/environment. A local `ghcr.io/dimensi/yazio-dashboard:latest` tag does not prove registry publication; a mutable tag is insufficient for rollback.

Verify migrations, health, login/logout and owner/trainer feature access through the real HTTPS hostname. Live YAZIO sync requires a separate acceptance check after the operator supplies an existing token.

For disposable image validation, build `docker build -t nutrition-foundation .`, then run `bash scripts/docker-smoke.sh`. Host tools `pdfinfo`, `pdffonts` and `pdftotext` are required. The script owns a separate `nutrition-smoke` project/volumes and verifies owner CLI, Secure cookies, restart persistence, online backup/restore, persistent uploads and synthetic Cyrillic PDF rendering with embedded fonts. Its volume cleanup must never target production.

## Consistent backup and rollback

Use SQLite online backup, which includes committed WAL state, rather than copying a live `.sqlite` alone:

```sh
docker compose -p nutrition -f compose.yaml -f compose.home.yaml --env-file runtime.env exec -T app node scripts/backup.mjs /app/data/operator-backup.sqlite
```

Export the backup from the volume to protected off-host storage. Verify `PRAGMA integrity_check` and expected records. Protect token/config backups separately. See the [database guide](architecture/database.md).

An online DB backup and separate live upload copy are not a cross-resource atomic snapshot. For a matching DB/upload pair, quiesce all writers and wait for in-flight sync/photo work, take the online DB backup and archive uploads before reopening writes. Stopping the app for the backup window is the simplest procedure; the bundled backup CLI can run in a one-off container against the same stopped stack volumes. Record revision, image digest and backup time. Validate referenced photos and rehearse restore on disposable volumes.

For rollback, stop the app, preserve the current DB/uploads, and choose the saved release image. If the schema is incompatible, restore that release's matching verified DB/upload backup while stopped, preserve ownership and configuration, then restart and validate health/authentication/photos. Remove obsolete WAL/SHM files only while the database is closed. Older images do not reverse migrations. Retain volumes and release images; never use `down -v` on the production project.
