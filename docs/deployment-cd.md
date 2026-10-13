# Nutrition continuous deployment

The Nutrition CD workflow uses the exact image artifact produced by successful main CI. It verifies the run and both jobs, revision, Git tree and archive hash, then refuses stale main immediately before submission. There is no second build or repeated full QA.

## Compose and release configuration

The repository owns `compose.yaml` and `compose.home.yaml`. The home overlay
records the existing Tempo HTTPS origin, encrypted store paths, enabled scheduler,
external `web` network and `nutrition` alias, with no host port. Keep the Compose
project `nutrition` so the existing database/uploads volumes are reused.

`runtime.env` is a protected, permanent file containing only the existing
`BETTER_AUTH_SECRET` assignment. `release.env` contains only `NUTRITION_IMAGE`
and `DEPLOYED_COMMIT`. Both are mode 0600 and ignored by Git. All operator and CD
Compose commands use `--env-file runtime.env --env-file release.env` in that order.
CD updates/rolls back only `release.env`; it never rewrites or copies the secret.
The bounded `verification/previous-release.env` records the immediately preceding
release for recovery. Do not rotate the auth secret: existing encrypted tokens
depend on it.

This change is an operator handoff, not an installed production change. Before
activating these candidate helpers, pause CD submissions, retain the existing
protected runtime configuration, and split its two release assignments into
`release.env`, preserving the secret assignment byte for byte in `runtime.env`.
Compare the existing nonsecret values with the repository overlay before removing
their assignments. Install the reviewed Compose files and both updated root-owned
helpers together, then validate with `compose config --quiet` (never print rendered
configuration). Do not recreate the app as part of configuration installation.
The next separately authorized release must use a completed successful main CI
artifact. No new registry credentials, access grants or security settings are needed.

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
the current stamp. Failed rollouts never prune. Legacy backups outside this new
namespace, unknown entries and incomplete sets remain untouched. A retention
failure warns without rolling back a healthy release. This is count-based local
retention, not off-host disaster recovery; keep the unchanged permanent secret in
protected off-host storage separately. CI incoming image archives and Docker images
are outside this snapshot policy.

Run `python3 scripts/cd/test-cd-candidates.py` for protocol, failure-injection and
actual retention checks. Add `--docker` for real snapshot/restore and corruption
refusal on disposable synthetic volumes using a prebuilt local
`nutrition-foundation:latest`; it never targets production volumes.

Activation requires NUTRITION_CD_ENABLED to be true and the separately approved constrained host installation and secure NUTRITION_DEPLOY_KEY handoff to be verified. Public repository variables are NUTRITION_DEPLOY_HOST, NUTRITION_DEPLOY_USER and NUTRITION_DEPLOY_KNOWN_HOSTS. The verified existing public SSH route uses port 2224; host checking is strict. Never commit or generically upload the private key. This configuration change does not alter activation, credentials or installed helpers.

The dedicated account has no Docker-group membership or general sudo. Its key forces the fixed gate; only the root-owned deploy handler is sudo-allowed. The handler accepts bounded USTAR with two fixed files, validates the archive and image, serializes with verification/rollout.lock, uses protected backups, verifies exact revision/health/HTTPS and rolls back on failure. Failed-state data is preserved before restoring a matching backup. Docker root and a stolen deployment key retain broad release-authority risk.

The Python guard tests use synthetic inputs and injected failures. An isolated Docker rollback rehearsal passed: original fixture DB, uploads, encrypted files, configuration and exact healthy image were restored, and failed-state backups were retained. Both fixture releases reused the same tested image; HTTPS failure was injected through a local shim. Migration-failure recovery and the first production CD run remain unverified. The reviewed host installer remains an operator handoff because existing sudo requires authentication. No self-hosted runner, firewall or VPN changes are needed.
