# Nutrition continuous deployment

The Nutrition CD workflow uses the exact image artifact produced by successful main CI. It verifies the run and both jobs, revision, Git tree and archive hash, then refuses stale main immediately before submission. There is no second build or repeated full QA.

## Compose and release configuration

The repository owns `compose.yaml` and `compose.home.yaml`. The home overlay
records the existing Tempo HTTPS origin, encrypted store paths, enabled scheduler,
external `web` network and `nutrition` alias, with no host port. Keep the Compose
project `nutrition` so the existing database/uploads volumes are reused.

`runtime.env` is a protected file containing the existing unchanged
`BETTER_AUTH_SECRET` assignment and the allowlisted runtime settings below. `release.env` contains only `NUTRITION_IMAGE`
and `DEPLOYED_COMMIT`. Both are mode 0600 and ignored by Git. All operator and CD
Compose commands use `--env-file runtime.env --env-file release.env` in that order.
CD updates/rolls back release metadata and the allowlisted runtime settings;
unrelated runtime assignments, including the auth secret, are preserved byte for byte.
The bounded `verification/previous-release.env` records the immediately preceding
release for recovery. Do not rotate the auth secret: existing encrypted tokens
depend on it.

This change is an operator handoff, not an installed production change. **Merging
into main can run the currently installed CD when `NUTRITION_CD_ENABLED=true`;
merging does not install these candidate helpers.** The following transition
requires separate authorization; this PR does not pause CD or change the server.

1. Obtain one explicit approval covering temporary CD pause, merge, coordinated
   configuration/helper installation, deployment of the successful main artifact,
   and restoration of the prior CD-enabled state after verification. Record the
   existing enabled state. Pause submissions before merging and confirm no queued
   or running deployment can reach the old handler; wait for any active rollout
   to finish. A variable change alone does not cancel an in-flight handler.
2. Verify the installed Compose supports `ports: !reset []` and multiple
   `--env-file` arguments using the reviewed files and synthetic env values.
   Retain protected copies of both installed helpers, both Compose files and the
   existing runtime configuration for reverting installation. Record live exact
   image/revision and the `nutrition` project's existing volume identities.
3. Merge only after the pause is verified. Wait for both main CI jobs to succeed
   on the exact merged SHA. Failed CI blocks deployment; do not rebuild its image.
4. While CD remains paused, stage and install both updated root-owned helpers
   (`nutrition-cd` and `nutrition-upgrade-ci-release`), both reviewed Compose files,
   and the split env as one coordinated installation. `release.env` initially
   pins the currently running image/revision, not the new artifact. Preserve the
   existing auth-secret assignment byte for byte in mode-0600 `runtime.env`.
   Confirm the nonsecret settings match the reviewed home overlay. Preserve project
   `nutrition`, network alias and the existing DB/uploads volumes. Do not run
   `up`, `down`, migrations or any recreate during preparation/installation.
5. Validate the installed configuration with both env files and
   `compose config --quiet`; never print rendered configuration. Verify exact
   current release identity, file ownership/modes and unchanged secret using
   comparison without printing its value. If preparation fails, restore the saved
   configuration/helpers while still paused; the running container remains intact.
6. Only under the explicit release approval, submit the exact successful main
   artifact through the updated handler. Check receipt, image/revision, Docker
   health, Tempo HTTPS health and authentication/data access. Resolve any rollback
   or retention warning before restoring the prior CD-enabled state. Resume only
   after that verification; keep the installation backup for operator recovery.

No new registry credentials, access grants or security settings are needed. These
approvals have not been granted or executed by this PR's implementation task.

## Managed backup sets

New snapshots live under `/app/data/cd-backups/{pre-upgrade,failed-before-rollback}-STAMP`.
Each contains the SQLite online backup, uploads archive, encrypted connection files
or explicit absence markers, both Compose files, release env and a `manifest.json`
with format version, UTC time, release image/revision and SHA-256 for each file.
The manifest is written last after DB integrity and archive validation. Hashing
uses bounded buffers. Rollback validates the manifest identity, required files,
hashes, DB integrity and archive before replacing data. Failed state is saved
before restoring the previous release configuration and matching data.

After a healthy successful upgrade, retention keeps the newest five deployment
stamps, grouping pre-upgrade and failed-state snapshots together, and always pins
the current stamp. A group counts only when its manifest metadata, exact required
regular-file inventory and all SHA-256 checksums validate. Missing/corrupt files,
links, unknown files or an invalid manifest protect the entire stamp, including
its otherwise valid counterpart, and do not consume a retention slot.
Failed rollouts never prune. Legacy backups outside this new
namespace, unknown entries and incomplete sets remain untouched. A retention
failure warns without rolling back a healthy release. This is count-based local
retention, not off-host disaster recovery; keep the unchanged permanent secret in
protected off-host storage separately. CI incoming image archives and Docker images
are outside this snapshot policy.

## Runtime channel v2

The SSH forced command, four metadata arguments and sudoers grant remain unchanged.
The strict USTAR stream now contains exactly `runtime-config.json`, `manifest.json`
and `image.tar.gz`. The config is a version-2 JSON envelope with exactly ten
allowlisted string fields, at most 16 KiB; duplicate keys, unknown fields, controls,
ambiguous dotenv quoting and other versions are rejected before image loading.
The stream remains limited to a 1 GiB image and a 600-second receive deadline;
lock contention fails immediately. Diagnostics contain fixed phase/reason codes,
elapsed time and received byte counts, never payloads or arbitrary error text.
Runs at or below the last successful receipt are refused; a failed transfer does
not create a successful receipt or authorize an automatic retry.

Environment `nutrition-production` supplies Secrets `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `ANAMNESIS_LLM_API_KEY` and Variables `S3_ENDPOINT`,
`S3_REGION`, `S3_BUCKET`, `ANAMNESIS_LLM_BASE_URL`, `ANAMNESIS_LLM_MODEL`,
`ANAMNESIS_LLM_TIMEOUT_MS`, `ENABLE_ANAMNESIS_WORKER`. This approved channel pins
S3 to `http://192.168.1.90:8333`, region `us-east-1`, private bucket `apps`, and
the Coding Plan endpoint `https://api.z.ai/api/coding/paas/v4`, model
`glm-5.3-flash`, timeout `120000`, worker `false`. Changing these requires review;
there is no paid API fallback or thinking override.

The workflow writes config only to a mode-0600 runner temporary file outside the
release artifact, then deletes it on exit and unsets the variables before SSH.
The receiver's root-private config staging file is deleted on every exit, including
partial upload and failed rollout. No config goes into image, artifact, manifest,
release.env, Docker command arguments or logs. Values containing single quotes,
backslashes, non-ASCII or controls are deliberately rejected, not escaped heuristically;
literal `$`, `#` and double quotes round-trip through actual Compose dotenv parsing.

After stopping the app and taking the existing consistent snapshot, a changed S3
configuration requires a fresh empty inventory of medical documents/import jobs
and local object files. A nonempty inventory aborts with the old release restored;
it requires a separate migration/backup plan. Disabling the worker does not disable
direct upload/reprocess/list-import kicks. No real medical PDF or pending job may
be used for activation testing.

Runtime updates publish a completed mode-0600 backup atomically under the root-only
`verification/runtime-backups/STAMP.env`, then atomically replace runtime.env on
the same filesystem. Failed writes cannot publish a partial rollback copy.
Rollback restores runtime.env before starting/health-checking the old image, even
if the failure precedes the normal data-backup-ready point. These small protected
runtime copies are retained for operator recovery; they are not included in image
diagnostics, data manifests or count-based data snapshot pruning.

Installation uses `scripts/cd/install-runtime-channel.sh` from a reviewed bundle
containing that script, both candidate helpers, `nutrition-runtime-config.py`,
`compose.yaml` and `compose.home.yaml` in one directory. Verify bundle hashes against
the reviewed commit, copy the bundle into a root-owned directory with root-owned
files and no group/other write permissions, pause CD submissions and confirm no active rollout first.
Run `sudo bash /absolute/bundle/install-runtime-channel.sh` on the server. It takes
the existing rollout lock, privately backs up installed files and runtime.env,
installs the three fixed helpers and both Compose files, validates Compose silently,
and verifies auth bytes and the running container ID/health are unchanged. It does
not change sudoers, SSH, NAS, volumes or recreate the container. Failed installation
restores the prior files. Keep the printed protected recovery directory.
The v2 workflow and receiver must be activated together while submissions are paused;
the old two-member protocol is intentionally not supported.

Run `python3 scripts/cd/test-runtime-config.py` as well as the existing candidate
tests. It uses synthetic secrets only and verifies allowlist/injection rejection,
literal Compose values, auth-byte preservation, partial backup/fsync/replace failures
and secret staging cleanup. Real Docker smoke runs on disposable volumes in CI.

Run `python3 scripts/cd/test-cd-candidates.py` for protocol, failure-injection and
actual retention checks. Add `--docker` for real snapshot/restore and corruption
refusal on disposable synthetic volumes using a prebuilt local
`nutrition-foundation:latest`; it never targets production volumes.

Activation requires NUTRITION_CD_ENABLED to be true and the separately approved constrained host installation and secure NUTRITION_DEPLOY_KEY handoff to be verified. Public repository variables are NUTRITION_DEPLOY_HOST, NUTRITION_DEPLOY_USER and NUTRITION_DEPLOY_KNOWN_HOSTS. The verified existing public SSH route uses port 2224; host checking is strict. Never commit or generically upload the private key. This configuration change does not alter activation, credentials or installed helpers.

The dedicated account has no Docker-group membership or general sudo. Its key forces the fixed gate; only the root-owned deploy handler is sudo-allowed. The handler accepts bounded USTAR with two fixed files, validates the archive and image, serializes with verification/rollout.lock, uses protected backups, verifies exact revision/health/HTTPS and rolls back on failure. Failed-state data is preserved before restoring a matching backup. Docker root and a stolen deployment key retain broad release-authority risk.

The Python guard tests use synthetic inputs and injected failures. An isolated Docker rollback rehearsal passed: original fixture DB, uploads, encrypted files, configuration and exact healthy image were restored, and failed-state backups were retained. Both fixture releases reused the same tested image; HTTPS failure was injected through a local shim. Migration-failure recovery and the first production CD run remain unverified. The reviewed host installer remains an operator handoff because existing sudo requires authentication. No self-hosted runner, firewall or VPN changes are needed.
