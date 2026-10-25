# yazio-dashboard — agent instructions

@/Users/n.nafranets/.codex/RTK.md

Read [README.md](README.md) and [parallel development](docs/agents/parallel-development.md) before editing.

## Purpose and scope

One self-hosted Next.js App Router application for an owner and an explicitly permitted trainer. This foundation includes authentication, infrastructure and placeholders only. Product features, YAZIO sync, photos, calorie calculations and PDF are separate work.

## Stack and layout

Node 22, pnpm 9.15.4, Next.js 16, React 19, Mantine 9 (the only UI kit), Drizzle + SQLite, Better Auth, Zod, Vitest and Playwright Test. Version decisions and peers: [ADR 001](docs/decisions/001-foundation.md).

- `src/app`: routes and thin composition. Server Components by default.
- `src/components/layout`, `src/components/shared`: common Mantine shell and UI.
- `src/features/{nutrition,measurements,workouts,analytics,reports,comments}`: independent feature modules. Add a public `index.ts` on implementation.
- `src/contracts`: versioned, transport-neutral Zod schemas and shared types.
- `src/server/{auth,db,yazio,jobs}`: secrets, authorization, SQLite and upstream integration.
- `src/config`, `src/styles`, `src/lib`: shared configuration, messages and utilities.
- `drizzle`: versioned SQL and metadata. `scripts`: operator CLI.
- `tests/{unit,integration,e2e}` and `docs/{architecture,agents,decisions}`.

## Imports and ownership

Use `@/*` aliases. Features must not import other features, including public entries; coordinate a contract in `src/contracts` instead. Never bypass a boundary using a relative import. No cycles. Shared modules do not depend on features. Server code must carry `import 'server-only'`; schema, connection, env and pure CLI-compatible modules are the documented exceptions. Browser code never imports database, Better Auth server or YAZIO. Route handlers call the server layer, which validates inputs with Zod. Map upstream payloads to v1 contracts before returning to UI.

An agent owns only the paths assigned in its task. Changes to contracts, schema/migrations, authentication, shared components, navigation/messages, dependencies, CI or deployment require separate coordination. The feature task does not automatically authorize changes to core. See [ownership map](docs/agents/feature-boundaries.md). Do not spawn agents or assign future product tasks as part of this foundation.

## Database and authorization

Use a worktree-local `DATABASE_URL=file:./.data/development.sqlite`; never share another worktree's DB. Server code uses `getDatabase()`. Keep transactions short; never await upstream HTTP inside a write transaction. One Next.js process with WAL and a 5s busy timeout is the supported deployment.

All changes to tables require reviewed schema and generated, committed SQL + metadata. Use `pnpm db:generate`, inspect SQL, then `pnpm db:migrate` on fresh and existing databases. Never production `drizzle-kit push`. Never edit a migration already deployed. See [database guide](docs/architecture/database.md).

`requireSession()` protects pages. Every server action/route accessing data calls `authorize(headers, permission, ownerId)`; do not omit the owner ID for data operations. OWNER is restricted to their own data; TRAINER requires an explicit `trainer_access` grant. Global owner-only operations use `yazio:manage` or `trainers:manage`. UI hiding is never authorization. Open registration remains disabled; role is input:false. No client secrets, raw upstream errors or personal debug endpoints.

## UI and testing

Use Mantine components and official App Router setup. Put user-facing Russian text in a message dictionary; introduce another locale through a resolver later. Only use client components for interaction/context. Maintain touch targets, keyboard navigation, theme persistence and no mobile overflow. Fixtures are explicitly `source: demo`, never persisted or rendered in production; load them through `src/server/demo.ts` for local feature previews. Tests may import fixtures directly.

### Photo lightboxes

When a photo needs an enlarged overlay/lightbox, use PhotoSwipe (`photoswipe`), the project's standard photo viewer. This is an explicit exception to the Mantine-only UI-kit rule for photo viewing. Do not build a custom photo lightbox with Mantine Modal, CSS transforms, or handwritten zoom, pan, pinch, double-tap, or swipe-to-close handlers. Let PhotoSwipe own those interactions and its viewer controls; ordinary thumbnails and photo forms remain Mantine UI.

Reuse the existing integration in `src/features/nutrition/ui/meal-photo.tsx` as the reference. For another feature, respect feature boundaries: coordinate a shared component instead of importing nutrition UI across features. Keep application integration limited to authorized image sources, lifecycle cleanup, Russian labels, accessibility and safe-area styling. Preserve existing authorization and cached-file handling. Do not introduce a second photo-lightbox library or a custom gesture engine without explicit user approval.

### Cached reads and degraded networks

[ADR 002](docs/decisions/002-resilient-client-reads.md) is the current product decision; [client read cache](docs/architecture/client-read-cache.md) describes its target implementation. The existing runtime still needs simplification. Do not treat old code/tests or historical benchmark results as requirements to restore the removed offline architecture.

Next.js App Router owns pages, links and history. Cache only resources actually loaded through the shared read layer. Show memory/IndexedDB data without waiting for a background request; refresh failure must not clear existing data or reset form input. Keep missing, empty and partial coverage distinct. Response/cache validation and auth-error handling belong in the data/API layer, not feature UI. User-input validation for form feedback remains appropriate.

Cold offline boot, navigation to unprepared routes, period snapshots and an offline shell are not requirements. Do not introduce a custom router, separate offline page tree, snapshot warmup or unbounded React Activity retention. Preserve dates, drafts and disclosures through ordinary navigation using explicit bounded state; connectivity alone must not replace the current screen. Explain unavailable actions at the affected control, without permanent network labels or generic offline banners.

Server-side authentication and owner/grant authorization remain mandatory. Cached data may stay readable while disconnected, including after an undetected remote trainer revoke. After the server reports a session-wide auth failure or revoked access, the common client handler logs out and clears local state. An action-level forbidden response must not trigger global logout; transport failures must not masquerade as denial. Per-frame concealment, BFCache conceal/reveal, local grant-expiry/clock checks and per-read device fences are not product requirements. Keep account separation and a simple request generation so late old-session responses cannot refill a cleared store. Notify other tabs of resets without a synchronous conceal protocol.

Logout remains available without the network, with durable server sign-out intent. Read-cache eviction must not delete pending writes. Preserve the existing owner write queue, idempotency, conflict handling and account checks before sending; its lifecycle must not depend on a shell/snapshot. Never cache credentials. Follow the current ADR when replacing obsolete offline tests; retain genuine server authorization and write-integrity assertions.

E2E resets only `.data/e2e.sqlite`. Never mock authentication in security smoke tests. Playwright supplies future PDF rendering capability, but browsers are not in the production image.

### Testing policy — lean suite and test budget

Tests are maintained only when their realistic regression-detection value justifies their complexity and runtime. Optimize for a **small, high-signal suite**, not test count, coverage percentage, or exhaustive scenarios. Existing tests are not a baseline to preserve.

**Budget for new test cases (per task, across unit, integration, and E2E):**

- **Default: 0 new tests.** Do not automatically add tests for a code change. A task is complete without new tests when the implementation is correct and relevant verification passes.
- Documentation, copy, styles, visual adjustments, and behavior-preserving refactors: **0**.
- Small behavior change or bug fix: **at most 1**.
- New feature: **at most 2**.
- Limits are ceilings, never quotas. Each `test`/`it` case and each parameterized row counts as one, even when placed in an existing file.
- Exceeding a limit requires **explicit user approval** with a concrete unprotected regression risk. Do not silently exceed the budget.

**What to test:**

- Only important observable behavior, nontrivial business invariants, or realistic significant regressions. In this project, prioritize owner/trainer authorization and data isolation, migrations and persisted data integrity, offline privacy/write safety, and synchronization correctness.
- Prefer a representative scenario at the lowest **effective** test layer. Do not repeat the same guarantee at unit, integration, and E2E levels.
- Do not test trivial getters, wrappers, mappings, component internals, every conditional branch, theoretical edge cases, or details of a particular implementation. Do not introduce fixtures, mocks, harnesses, or abstractions just to make low-value tests possible.
- **New E2E tests require explicit user approval**, even within the numeric budget. Reserve E2E for essential real-user journeys, not individual components, UI permutations, or every visible behavior change.

**Prune rather than accumulate:**

- Treat existing tests as candidates for **removal, consolidation, or replacement**. Delete obsolete, overlapping, brittle, flaky, implementation-coupled, and low-signal tests; do not preserve them for historical coverage or green test counts.
- Prefer extending or replacing one valuable scenario instead of accumulating several narrow tests. Aim for **zero or negative net test-case growth** during ordinary tasks.
- Evaluate what regression protection remains after pruning, rather than preserving particular tests. Important invariants should still have appropriately focused protection.
- The repository-wide cap is enforced by `pnpm test:budget`: **3 unit, 8 integration, 2 browser E2E, 14 total test cases**. It collects Vitest and Playwright cases rather than grepping source. `verify:merge` then requires JSON execution reports to match that manifest exactly, with no skipped or retried case. Replacing a case is preferred; growing past any cap requires explicit user approval and a concrete regression gap.
- **Runtime is also a budget.** Prune expensive low-value tests and avoid adding slow suites. The fixed caps below are enforced by `verify:merge`; investigate a persistent regression rather than compensating with more parallel test infrastructure.

**Before adding any test**, identify the specific plausible regression, check whether another test already catches it, and justify its cost. If there is no compelling gap, add **zero** tests.

**Reporting:** State added, removed, and consolidated test-case counts (including zero), meaningful remaining regression coverage, and the exact checks actually run.

### Fixed runtime budget

`pnpm verify:merge` measures and enforces these wall-clock ceilings on the final committed revision. Each command runs in its own process group and is terminated at its deadline, so a hung child cannot bypass the cap:

- `pnpm test:unit`: **30 seconds**
- `pnpm test:integration`: **60 seconds**
- `pnpm test:e2e`: **90 seconds**
- complete `pnpm verify:merge`: **5 minutes**

The limits deliberately leave room above the compact suite's normal runtime for a busy developer machine. Do not add worker farms, duplicate viewports, or slow diagnostic matrices to meet them.

## Checks and PRs

Do not add backward compatibility. Replace obsolete routes, interfaces and contracts directly; do not introduce compatibility shims, legacy fallbacks, deprecation layers or dual support solely to retain old behavior. Preserve user data, credentials and security controls when making these changes.

Choose and record the verification tier before implementation. Base it on changed runtime paths, user-visible behavior and blast radius, not on habit or the number of edited lines. Use the narrowest tier that can prove the affected behavior. If scope expands, raise the tier before continuing. In the PR or merge report, state the chosen tier, why it applies and the exact checks actually run. Never claim unrun checks.

| Tier      | Use when                                                                                                                                                                                                                                      | Required checks                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs-only | Only Markdown, agent instructions, comments or other non-executable documentation changed.                                                                                                                                                    | `git diff --check` and Prettier on the changed documentation files. Do not run unit, build or E2E solely for this tier.                                                                 |
| Test-only | Only tests, fixtures or test documentation changed without altering runtime code or test infrastructure.                                                                                                                                      | Formatting/lint for changed files and the directly changed test suites.                                                                                                                 |
| Isolated  | A bounded UI, copy, style or business-rule change has a known local dependency surface.                                                                                                                                                       | Format, lint, typecheck and relevant unit/integration tests; run any affected existing E2E checks for user-visible changes, but do not auto-add cases.                                  |
| Full      | The change affects shared navigation/layout, authentication or authorization, offline lifecycle/storage/routing, shared contracts, schema/migrations, dependencies, build/CI/deployment, multiple features, or has an uncertain blast radius. | `pnpm verify:merge` on the final committed revision with a clean working tree. Runtime/deployment infrastructure changes also build the image and run the disposable Docker smoke test. |

Do not escalate a lower tier merely because an unrelated test exists, and do not downgrade a tier because the diff is small. A one-line authorization, schema, routing or shared-contract change is still Full. A documentation-only change remains Docs-only even when it describes critical runtime behavior.

For Full verification, `pnpm verify:merge` runs format, lint, typecheck, the enforced test budget, compact unit and integration suites, one production build, then two desktop browser smoke journeys: authenticated diary/workout/offline/logout/trainer isolation and durable YAZIO sync. The canonical launcher is `scripts/verify-merge.mjs`, not a benchmark. It uses no worker farm or per-case Next process: `pnpm test:e2e` picks one free local HTTPS gateway/backend pair and each serial browser suite receives a fresh worktree-local `.data/e2e.sqlite`. A lock prevents concurrent E2E processes from sharing it. Real test authentication remains mandatory; mobile E2E is added only with explicit approval for an independent mobile risk.

When the Full tier applies, every configured compact check must pass with no retries; discovered and executed test identities must match exactly. Rerun after any subsequent runtime change or rebase. Record the final SHA, exact command, case counts and durations from `test-results/merge-verification.json` in the PR or merge report. The command never merges or deploys. CI does not run for PRs and main deployment does not run E2E, so neither replaces required Full verification. Merge still requires the task's authorization. For focused diagnosis use `pnpm test:e2e smoke`, `pnpm test:e2e nutrition`, `pnpm test:unit`, or `pnpm test:integration`; do not rebuild the removed orchestration around them.

One agent = one branch = one Git worktree. Do not commit directly to main
unless the user explicitly requests a direct commit to main in the current
conversation. Keep PRs narrow; describe changed behavior, contracts/migrations, checks actually run, risks and remaining limitations. Do not commit `.env`, databases, tokens, uploads, test artifacts or production data. Never merge/deploy without the task's authorization. Do not invent product schemas or normalization algorithms.

## Mandatory cleanup after merge

After a task's MR/PR is confirmed merged, always clean up its own resources without waiting for another cleanup request: stop only processes whose ownership belongs to this task, delete its remote and local feature branches, and completely remove its Git worktree and task-owned generated files, including ignored dependencies, builds, synthetic databases, uploads and test artifacts. Use `git worktree remove` with the exact verified task path, then remove an empty task wrapper directory if present. For squash merges, first verify the PR is merged before deleting its local branch. Never touch other agents' worktrees, branches, processes or user data.

Local previews are task-owned resources even when the user explicitly asked to start them for review. Keep them running while review is active; after merge and successful deployment verification, stop them automatically before the final response unless the user explicitly asks to keep them running. Do not restart a preview as part of cleanup. An explicit request to stop the project or clean up requires the same shutdown immediately, without waiting for a merge.

Record the task's process/session IDs and ports when starting servers, workers, browser automation or verification runners. During cleanup, stop only those owned processes, then verify that their PIDs have exited and their ports have no listener. A successful stop command or completed terminal session alone is not proof. Include disposable verification checkouts outside Git worktrees, temporary scripts, test artifacts and task-created browser sessions in cleanup; preserve the user's original local data and connections. Never use broad process kills or delete unrelated temporary files.

The final merge/deployment or cleanup report must explicitly state whether the local preview is stopped and which task branches, worktrees and temporary resources were actually removed. If a process, listener or resource remains, name it and explain why; do not claim cleanup is complete. The user must not need a separate reminder after a completed release.

Do NOT archive worktrees, create ZIP/tar backups, recovery snapshots or use `archive_worktree` as cleanup. "Clean up" means delete, not preserve an archive. Inspect status first: if uncommitted or unpushed changes are not clearly disposable task-generated files, stop and ask rather than delete or archive them. Confirm the path is absent and no longer registered with Git, and report what was actually deleted. Never report a queued archive operation as completed cleanup. Before merge, retain the worktree needed for the active task; this cleanup rule does not grant merge permission.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
