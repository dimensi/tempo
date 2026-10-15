# Offline writes task ownership

Base: origin/main e7a83d6 (rebased from the initial 567c387 inspection). Branch: codex/offline-writes. One agent/worktree; no delegation.

Owned scope: offline write v1 contracts; IndexedDB queue/client; OWNER workout/measurement save adapters; offline capture/status UI; dashboard composition; pending-write logout guard; scoped offline server write API and receipt repository; receipt schema/generated migration; optional stable session ID in the existing workout repository; focused unit tests and offline-write documentation.

Shared changes are limited to what the requested durable queue, server deduplication and logout guarantees require. Existing authentication/permission rules and external write safeguards remain authoritative. No dependency, CI, secret, production-data or deployment changes.

Acceptance checks: targeted offline-write unit files, typecheck and lint only. Browser/E2E, full tests/build, Actions and deployment are prohibited by this task. No merge. See `docs/architecture/offline-writes.md` for the manual scenario and remaining verification limits.
