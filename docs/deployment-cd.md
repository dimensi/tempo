# Coolify deployment

Host recovery and the Bitwarden credential handoff: [Home server / Coolify runbook](https://github.com/dimensi/reels-downloader/blob/main/docs/operations/home-server-coolify.md).

Tempo's release workflow builds the reviewed revision once, publishes it to GHCR,
then asks the existing Coolify installation to deploy that exact Git SHA tag. Coolify
owns the container lifecycle and runtime configuration. GitHub Actions does not copy
Compose files, application environment values or production data to the server.

## Image and release workflow

The `build` job keeps the existing BuildKit strategy. Main releases publish three
references to the same image:

- `ghcr.io/dimensi/tempo:<40-character Git SHA>` for deployment;
- `ghcr.io/dimensi/tempo:latest` for humans and cache lookup;
- `ghcr.io/dimensi/tempo:buildcache` for the shared inline cache.

Manual non-main builds publish the SHA, the existing branch cache tag and
`buildcache`, but do not deploy. Documentation and deployment files remain outside
the Docker context, so a deployment-only change can reuse the application layers.
The workflow does not run PR checks or the Full verification tier; follow
[AGENTS.md](../AGENTS.md) before merge.

On main, the `deploy` job updates only the non-secret `DEPLOYED_COMMIT` runtime
variable and the Coolify application's `docker_registry_image_tag` to the same
Git SHA, starts a deployment, waits for a terminal status, checks that the saved
tag still equals the workflow SHA, and requires HTTP 200 from
`https://tempo.dimensi.dev/api/health`. The public check polls for up to one minute
so a short startup 503 or connection reset does not fail an otherwise healthy
deployment. The image's existing command runs
`node scripts/migrate.mjs` before `server.js`, and its Docker health check covers
`/api/health`. Do not configure a second migration or scheduler command in Coolify.

Production concurrency remains `nutrition-production`, with cancellation disabled.
A newer workflow waits for an already-started native deployment instead of
cancelling it between the tag update and terminal status. Coolify uses a consistent
container identity and a stop-first replacement for this single-process SQLite
application; rolling two replicas would run concurrent migrations and schedulers
against the same files.

## Coolify application contract

Create a Docker Image application with the following values:

- Coolify: `https://coolify.dimensi.dev`
- server: `home-server` (`qqojrctskvoplg5s9knrxkeh`)
- image: `ghcr.io/dimensi/tempo`
- initial tag: the currently verified production Git SHA
- exposed container port: `3000`
- domains and Coolify proxy: none
- Docker restart policy: `unless-stopped`
- `is_consistent_container_name_enabled`: `true`
- `custom_internal_name`: `nutrition`
- external Docker network: `web`
- `stop_grace_period`: `30` seconds for an orderly single-process shutdown
- Coolify-generated health check: disabled; inherit the image's Node-based
  `/api/health` `HEALTHCHECK`
- pre-deployment command:
  `node scripts/backup.mjs /app/data/coolify-pre-deploy.sqlite`
- automatic image updates: disabled
- `docker_images_to_keep`: `0`
- persistent volume `nutrition_database` mounted read/write at `/app/data`
- persistent volume `nutrition_uploads` mounted read/write at `/app/uploads`

Caddy remains the only public proxy and keeps the existing route:

```caddyfile
tempo.dimensi.dev {
	reverse_proxy nutrition:3000
}
```

Do not publish a host port or create a Coolify domain. The application must join
the existing external `web` network with alias `nutrition` before Caddy is switched
to it. Preserve the server cleanup threshold of 80%, keep unused-volume and
unused-network cleanup disabled, and keep the native Coolify scheduler enabled.

Use the existing named volumes. A newly generated Coolify volume with an empty
database is a failed cutover, even when `/api/health` returns 200. Never remove,
rename or initialize the existing volumes during application creation.

## Runtime environment

Copy the current production values directly into Coolify as masked runtime
variables. Do not move values through GitHub Actions, repository files, tickets or
logs. Preserve every value exactly, including the existing auth key and object
storage credentials:

- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `UPLOADS_DIR`
- `DEMO_MODE`
- `YAZIO_TOKEN_FILE`
- `TRANSFORMMATE_TOKEN_FILE`
- `ENABLE_NUTRITION_SCHEDULER`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `ANAMNESIS_LLM_BASE_URL`
- `OPENROUTER_API_KEY`
- `ANAMNESIS_LLM_MODEL`
- `ANAMNESIS_LLM_TIMEOUT_MS`
- `ENABLE_ANAMNESIS_WORKER`

Also create `DEPLOYED_COMMIT` as a non-secret, literal runtime variable. The release
workflow owns only this variable and sets it to the exact image SHA immediately
before each deployment. The application health route checks database availability;
the immutable OCI revision label and Coolify image tag remain the authoritative
running-build checks.

The image supplies `NODE_ENV`, `HOSTNAME`, `PORT`, Chromium/font paths and Next.js
telemetry defaults. They do not need duplicate Coolify values unless the running
container audit shows an intentional override.

The encrypted files `/app/data/yazio-token.json` and
`/app/data/transformmate-token.json` depend on the existing `BETTER_AUTH_SECRET`
and owner identity. Preserve the files, database and secret as one recovery set.
Never decrypt either file as a migration test.

## GitHub Actions secrets

The `nutrition-production` environment needs only these deployment secrets after
cutover:

| Secret             | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `COOLIFY_URL`      | Coolify base URL, currently `https://coolify.dimensi.dev`         |
| `COOLIFY_APP_UUID` | Identifies only the Tempo Docker Image application                |
| `COOLIFY_TOKEN`    | Updates the revision variable/image tag, deploys and reads status |

Use a dedicated token with the narrowest available permissions and description:

`GitHub Actions — dimensi/tempo — update image tag and deploy`

Link its internal credential record to the repository release workflow. Rotate it
by installing the replacement secret, completing and verifying a manual main
deployment, then revoking the former token.

After the first verified Coolify release, remove the obsolete
`NUTRITION_DEPLOY_*` SSH/path/runtime-checksum secrets and the duplicated S3/LLM
runtime secrets from GitHub. Keep runtime application values only in Coolify.
Retire the old forced-command deployment key or helper only after rollback no
longer relies on it.

## Stateful cutover

The cutover must be serialized; the old Compose app and Coolify app must never run
together against `nutrition_database`.

1. Record the running image digest, OCI revision, health, scheduler flags, mounts,
   volume identities, `web` aliases and Caddy route.
2. Quiesce writes. Create a SQLite online backup and a matching protected copy of
   uploads, both encrypted connection files and runtime configuration. Verify the
   database backup before changing container ownership.
3. Create the Coolify application at the same verified image SHA with automatic
   deployment disabled. Configure all environment values, existing named volumes,
   consistent naming, `web` network and `nutrition` alias.
4. Stop the old Compose container. Confirm no Tempo container remains running and
   keep the old Compose configuration available for rollback.
5. Start the same image through Coolify. Startup applies any pending migrations;
   wait for the Docker health check and public health endpoint.
6. Verify the running image/revision, single-container count, zero restarts,
   volume mount sources, database integrity, encrypted-file presence, scheduler
   flags, Caddy routing, login and representative owner/trainer reads. Do not run
   real imports, OCR, sync or outbound integration tests during cutover.
7. Add the three GitHub secrets and run the release workflow manually on main.
   Verify the exact SHA tag and public health before enabling ordinary main-push
   deployments.

The coordinator owns the backup and stop/start window. Do not let a workflow push
activate the new CD path before the resource and recovery set are verified.

The completed migration was verified at revision
`a4d42fa0e3d6556f95ec30a255d1985cf45c96ba` by
[Release run 39136461370](https://github.com/dimensi/tempo/actions/runs/39136461370).
The sanitized machine-readable evidence is in
[`migration-verification.json`](migration-verification.json). It records the exact
native container contract, persistent-volume checks, fixed pre-deployment backup,
public health and unchanged host baselines without environment values, credentials
or personal records.

## Failure and rollback

If Coolify fails before the new app starts, keep the existing volumes untouched,
stop/delete only the failed Coolify container, and restart the recorded Compose
image with its original environment and `web` alias. If startup ran migrations,
inspect the schema and logs before rollback: an older image does not reverse a
migration. Restore the matching verified recovery set only while all Tempo
containers are stopped.

Coolify image retention is zero by user policy, so rollback depends on the
recorded immutable image reference and registry availability rather than local
image history. Never use `docker compose down -v`, delete a Coolify storage record
that owns an existing volume, or prune the two production volumes.

For later releases, Coolify runs the bundled SQLite online backup before replacing
an existing managed container. The fixed
`/app/data/coolify-pre-deploy.sqlite` destination is intentionally overwritten, so
routine deployments do not accumulate backups in the database volume. This hook
does not run before the first Coolify start because no managed container exists.
Create and verify the documented root-private stateful backup before that cutover
and before later schema or storage changes. The native hook does not capture
uploads, encrypted connection files or runtime configuration, so it does not
replace the full database/upload recovery procedure.
