# Nutrition deployment

Tempo uses the same basic deployment path as `dimensi/dark-corses-vault`:
One workflow (`.github/workflows/release.yml`) builds the image, publishes it to GHCR, then copies env/Compose
and runs ordinary SSH commands `docker compose pull` and `up --wait`.
No deployment receiver, custom archive protocol, installer or new server helper is used.

## Image and checks

Release runs on main pushes or manually on a selected branch. The `build` job checks out the revision,
builds the image and publishes it to GHCR. The `deploy` job depends on `build` and
checks out the same revision before SSH deployment. Deployment runs automatically after a successful build on main.
PR CI, formatting, lint, typecheck, unit/integration tests, browser gates and
disposable Docker smoke do not run in this workflow. Required pre-merge checks follow the verification tiers in AGENTS.md. Full
verification uses `pnpm verify:merge`, including two browser smoke journeys.
A main push builds and publishes that exact checked-out revision as
`ghcr.io/dimensi/tempo:latest` using the job's `GITHUB_TOKEN`.
There is no second build. Publication updates `latest` and returns its immutable
`ghcr.io/dimensi/tempo@sha256:...` reference as a job output. Deployment
pulls that exact digest, so a retry cannot accidentally pick a later `latest`.
The immutable revision label must match the workflow SHA before startup and after deployment. There is no manual full-test CI branch.

Buildx embeds inline cache metadata in the published image and imports it from
the target tag, `buildcache` and `latest`. `buildcache` is another tag on the same
published image, allowing manual branch builds and main to share matching cache
records without transferring another image. Only main updates `latest`.
It does not upload intermediate builder layers to
GitHub Actions Cache. Dependency installation runs against the frozen lockfile;
shipping the complete builder filesystem cost more than installing these packages.
The Next.js build still performs TypeScript checking.

The Dockerfile explicitly copies application source, public assets, build
configuration, migrations and the operator scripts shipped in the image.
Documentation, CI/deployment scripts and Compose files are not application build
inputs; Markdown files are excluded even inside asset directories. Changes to
these excluded files retain the application build cache. New runtime build inputs
must be added to the Dockerfile's explicit `COPY` list. Local Full verification
still checks the complete repository, including tests and development tools.

Chromium, FFmpeg, fonts and system libraries live in an independent runtime stage.
The application, canonical SDK/Playwright packages and operator CLIs are assembled
and checked in the builder, then added with one `COPY --link` using numeric
ownership. No filesystem-changing command follows it in the final stage. BuildKit
can therefore reuse the runtime layers already in GHCR without downloading and
extracting them on the runner. The server also reuses those layers on subsequent
pulls. A separate base-image workflow is unnecessary: the runtime stage and inline
cache retain the same dependency boundary. Missing cache performs a full build;
the first publication with this format primes the inline cache. Build records are
not uploaded as artifacts.

Manual non-main runs publish `build-<branch-hash>` and the shared `buildcache`,
and skip deployment. The branch
tag uses the first 16 hex characters of SHA-256 over the full Git ref, so different
branches have separate tags and new commits can reuse their own branch cache.
These builds never update `latest` or read production environment secrets.
Use Actions job and step durations plus
build logs for performance comparisons; local build times are not release timings.

Deployment runs only after the `build` job succeeds, and accepts
only the current main SHA. Manual runs have no external run ID or revision inputs.
No Actions artifacts are uploaded or downloaded. Production concurrency remains
`nutrition-production`, cancel-in-progress true: each new main push or manual main run cancels the
previous running main release in this group, including an in-progress build or deploy.
Manual branch builds use separate branch-scoped concurrency groups. SSH verifies the existing host key
on the port configured in the production environment. The pulled image revision label and final running image/revision must match.

The image repository follows `GITHUB_REPOSITORY`. Renaming the source repository
to `dimensi/tempo` changes future publications to `ghcr.io/dimensi/tempo`; it does
not migrate existing image tags. The server path `/opt/compose/yazio-dashboard`,
Compose project `nutrition`, network alias and persistent volumes stay unchanged.

## Retrying a release

Image downloads automatically retry transient transport failures (including GHCR
TLS handshake timeouts) up to three total attempts, waiting 5 then 10 seconds.
Authentication, missing-image and other non-transient failures stop immediately.
Only `compose pull app` is repeated, against the same immutable digest, before
backup, migrations or container replacement. Exhausting the attempts leaves the
current application running and fails the deployment; raw pull logs remain private
and are removed with the temporary deployment directory.

In GitHub Actions, select the failed `deploy` job and use **Re-run jobs**, or choose
**Re-run failed jobs** on the run. The successful `build` job and its image output
are reused, so deployment retries do not rebuild or republish the image. A full
workflow rerun executes both jobs. The current-main revision guard still applies:
retrying an older release after main advances is intentionally rejected.
Pruning remains after successful health verification inside `deploy`.

## Files and secrets

The workflow copies repository `compose.yaml`, `compose.home.yaml` and a generated
mode-0600 `.env.deploy` using SCP into a private temporary directory under
`/opt/compose/yazio-dashboard`. It then uses SSH to pull the image, install those
three configuration files, and run Compose. All Compose commands explicitly use
project `nutrition`, the existing `runtime.env` first, then `.env.deploy`.
The existing database/uploads volumes and network alias are preserved; no down,
volume deletion, auth bootstrap or secret rotation is performed. After successful startup
and HTTPS health verification, image pruning removes only unused images carrying this
repository's source label. Running/container-referenced images are retained. Build-cache
pruning removes unused cache older than seven days across the Docker daemon;
volumes and other applications' images are not pruned.
`runtime.env` and historical `release.env` are never overwritten or copied to CI.
The current auth secret therefore remains server-local.

### Private deployment configuration

All deployment infrastructure settings are individual Secrets in the
`nutrition-production` environment. The workflow does not read their former
repository/environment Variables. Deployment needs no enablement Variable.

- SSH: `NUTRITION_DEPLOY_HOST`, `NUTRITION_DEPLOY_USER`,
  `NUTRITION_DEPLOY_PORT`, `NUTRITION_DEPLOY_KNOWN_HOSTS`, `NUTRITION_DEPLOY_KEY`.
- Existing stack: `NUTRITION_DEPLOY_PATH`, `NUTRITION_DEPLOY_PROJECT`,
  `NUTRITION_DEPLOY_HEALTH_URL`. Keep the established path, project, volumes,
  network and health endpoint when configuring these values.
- Runtime: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `OPENROUTER_API_KEY`, `ANAMNESIS_LLM_BASE_URL`,
  `ANAMNESIS_LLM_MODEL`, `ANAMNESIS_LLM_TIMEOUT_MS`, `ENABLE_ANAMNESIS_WORKER`.
  The existing repository-level OpenRouter secret is also supported by GitHub's
  normal secret resolution; the workflow has no variable or plaintext fallback.
- Approval guard: `NUTRITION_DEPLOY_RUNTIME_SHA256` is the SHA-256 of compact,
  sorted-key JSON for the seven noncredential runtime settings listed in
  `scripts/cd/deploy.sh`. An intentional runtime configuration change must update
  both the corresponding Secrets and this checksum. Credentials are excluded
  from the checksum, so credential rotation does not change the runtime guard.

The deployment body lives in `scripts/cd/deploy.sh`; the public Actions step
contains only its invocation and output handling. GitHub masks Secret values in
its step header. Raw SSH, SCP, Compose and validation output is captured in a
mode-0600 runner-temporary file and removed on exit, never printed or uploaded.
Public output reports success or a fixed, allowlisted failure phase. Debugging
requires private operator inspection; do not print that temporary log or add it
to artifacts. This also prevents error messages from exposing addresses, resolved
hosts, paths, fingerprints or connection strings that differ from a Secret's
exact value.

Env serialization rejects controls, single quotes and backslashes rather than
accepting ambiguous dotenv escapes; literal dollars/hash/double quotes are quoted.
The approved runtime checksum, exact main SHA, image digest, host-key verification,
backup, storage-switch guard and health checks remain mandatory.

Setting Secrets does not erase old logs, source history or existing Variables.
Remove superseded infrastructure Variables only after the workflow no longer
reads them. Delete exposed historical logs or their entire workflow runs separately
using the Actions API. Deletion does not rewrite Git history or erase previously
copied data.

Registry authentication uses the short-lived job `GITHUB_TOKEN` via stdin and a
private temporary `DOCKER_CONFIG`. It does not replace the server's existing
registry login and does not introduce a permanent registry credential. Temporary
key/env/token/config files are removed on exit. Abrupt machine failure can leave a
private staging directory; inspect/remove only the corresponding run directory.

## Cutover and failures

The workflow takes the existing `verification/rollout.lock`, also used by installed
legacy receivers. It pulls and validates the new image before stopping anything.
It invokes the application's existing online SQLite backup CLI before migrations;
the protected backup remains under `/app/data/pre-deploy-RUN-SHA.sqlite`.
Before first S3 activation or an S3 configuration change it stops the old app,
checks document/job counts and local object files read-only with networking disabled,
and refuses nonempty storage. An inventory/pre-cutover failure restarts the old
container without changing its configuration. Nonempty storage requires a separate
migration/backup plan; disabling the worker alone does not prevent direct queue kicks.

After Compose starts replacing the app, startup or health failure fails the workflow
and leaves the state available for inspection. Like the reference deploy, it does
not automatically restore SQLite or promise an automatic release rollback. Do not
retry blindly after migrations: inspect health and choose recovery against the
recorded image/config and online backup. HTTPS health must be 200 for success.
Only synthetic PDFs may be used for activation testing; real documents or pending
imports must not be processed as a test.

## Existing access and activation

Deployment uses the production environment after a successful build on main.
The workflow requires an SSH account that can read the existing runtime file,
write the stack directory and use Docker. It refuses the obsolete receiver-only
account because ordinary SCP/SSH deployment requires a different interface.
This logging change does not grant new server privileges, rotate credentials,
run a deployment or alter the server's existing registry login.

Before activation, verify the final revision and required checks, configure the
individual Secrets and approved runtime checksum, and confirm the current
server path/project/volumes. If GHCR package policy denies job-token access,
resolve that specific policy; do not automatically create a PAT or permanent
server credential. Retain the existing rollout lock and recovery procedure.
