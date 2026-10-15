# Offline writes task ownership

Base: origin/main df3fe70 (rebased from the initial 567c387 inspection). Branch: codex/offline-writes. One agent/worktree; no delegation.

Owned scope: offline write v1 contracts; IndexedDB queue/client; OWNER workout/measurement save adapters; offline capture/status UI; dashboard composition; pending-write logout guard; scoped offline server write API and receipt repository; receipt schema/generated migration; optional stable session ID in the existing workout repository; focused unit tests and offline-write documentation.

Shared changes are limited to what the requested durable queue, server deduplication and logout guarantees require. Existing authentication/permission rules and external write safeguards remain authoritative. No dependency, CI, secret, production-data or deployment changes.

Release authorization now includes full tests, E2E, push, PR, merge and production deployment. All three complete mandatory E2E suites must pass on the final revision before merge. Workflows, secrets and access permissions remain unchanged. Exact release evidence is recorded in the PR; see `docs/architecture/offline-writes.md` for scope and the acceptance scenario.
