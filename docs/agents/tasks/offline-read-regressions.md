# Offline read regression checks

- Objective: restore the three failing offline read checks without weakening session or scope isolation.
- Branch/worktree: `codex/fix-offline-read-regressions`, `offline-read-tests`.
- Owned paths: `tests/integration/offline-read.test.ts`, `src/server/offline/index.ts`, this task note.
- Shared change: return 401 when the session disappears during the final owner lookup; keep 403 for missing owner grants.
- Contracts, schema, permissions, queue and production data: unchanged.
- Fixtures: existing in-memory SQLite and synthetic temporary token store only.
- Checks: the affected integration file, related offline authorization unit tests, lint and typecheck. No full suite, E2E, merge or deployment.

## Verification

- Baseline `b7c7f7a`: affected integration file reproduced all three failures (8 passed, 3 failed).
- `pnpm exec vitest run tests/integration/offline-read.test.ts tests/unit/offline-authorization.test.ts tests/unit/offline-write-queue.test.ts`: 34 passed.
- TTL negative control: temporarily removing the minimum expiry caused the revised expiry test to fail; original production code restored afterward.
- `pnpm lint`, `pnpm typecheck`, changed-file Prettier and `git diff --check`: passed.
- No full test suite, browser tests or production checks performed for this change.
