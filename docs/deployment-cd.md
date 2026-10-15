# Nutrition deployment

Tempo uses the same basic deployment path as `dimensi/dark-corses-vault`:
One workflow (`.github/workflows/release.yml`) builds the image, publishes it to GHCR, then copies env/Compose
and runs ordinary SSH commands `docker compose pull` and `up --wait`.
No deployment receiver, custom archive protocol, installer or new server helper is used.

## Image and checks

Release runs on main pushes or manually on main. One job executes checkout, Docker build,
GHCR publication and SSH deployment as separate sequential steps. Deployment runs only
when `NUTRITION_CD_ENABLED` is `true`; build and publication remain available otherwise.
PR CI, formatting, lint, typecheck, unit/integration tests, browser gates and
disposable Docker smoke do not run in this workflow. All three full E2E suites
are mandatory before every merge into main, as specified in AGENTS.md.
A main push publishes that exact local image as
`ghcr.io/dimensi/yazio-dashboard:latest` using the job's `GITHUB_TOKEN`.
There is no second build. The moving `latest` tag is used for publication and deployment;
the immutable revision label must match the workflow SHA before startup and after deployment. There is no manual full-test CI branch.

Deployment runs only after build and publication succeed in the same job, and accepts
only the current main SHA. Manual runs have no external run ID or revision inputs.
No Actions artifacts are uploaded or downloaded. Production concurrency remains
`nutrition-production`, cancel-in-progress true: each new main push or manual main run cancels the
previous running release in this group, including an in-progress build or deploy. SSH verifies the existing host key
on port 2224. The pulled image revision label and final running image/revision must match.

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

`nutrition-production` supplies Secrets `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`OPENROUTER_API_KEY` and Variables `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`ANAMNESIS_LLM_BASE_URL`, `ANAMNESIS_LLM_MODEL`, `ANAMNESIS_LLM_TIMEOUT_MS`,
`ENABLE_ANAMNESIS_WORKER`. They retain the approved values:
S3 `http://192.168.1.90:8333`, region `us-east-1`, private bucket `apps`;
OpenRouter `https://openrouter.ai/api/v1`, `google/gemini-3.8-flash`, timeout `120000`,
worker `false`. There is no fallback to the subscription provider or thinking override.
Env serialization rejects controls, single quotes and backslashes rather than
accepting ambiguous dotenv escapes; literal dollars/hash/double quotes are quoted.
Secrets are never added to Git, images, artifacts or command arguments.

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

`NUTRITION_CD_ENABLED` stays false until coordinated activation is approved.
The existing `nutrition-deploy` key accepts only a forced receiver command, so it
cannot perform SCP or ordinary SSH deployment. The workflow explicitly refuses
that account. The already available host account `dimensi` can read runtime.env,
write the project directory and use Docker; the shared rollout lock is writable.
Using its ordinary SSH credential from GitHub Actions requires a separate explicit
credential/access decision. No key is read, uploaded or replaced by this PR.

The server already has a GHCR login, which is left untouched. The existing Tempo
package/latest manifest was not readable during the original inspection; the release
workflow publishes the repository-linked `latest` image with its job token. If package policy denies job-token
pull, stop and resolve that specific access issue; do not create a PAT or permanent
server login automatically.

Already installed legacy helpers are retained and not called by the new workflow.
Do not rerun the prior installer, merge the old transport design or invoke a legacy
rollout concurrently. Before activation verify the exact PR head/checks and absence
of active deployments, approve ordinary SSH credentials, then merge and wait for
successful release build, publication, deployment and health/synthetic verification.
