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

Write meaningful unit tests for business rules, integration tests for persistence/authorization, E2E for real interactions. E2E resets only `.data/e2e.sqlite`. Never mock authentication in security smoke tests. Playwright supplies future PDF rendering capability, but browsers are not in the production image.

## Checks and PRs

Do not add backward compatibility. Replace obsolete routes, interfaces and contracts directly; do not introduce compatibility shims, legacy fallbacks, deprecation layers or dual support solely to retain old behavior. Preserve user data, credentials and security controls when making these changes.

Run `pnpm verify:merge` for pre-merge verification. It runs format, lint, typecheck, unit/integration tests, one production build and the complete mandatory E2E suites below. For infra changes also build the image and run the disposable Docker smoke test. No fictional success scripts or claimed unrun checks.

MANDATORY BEFORE EVERY MERGE INTO `main`: run `pnpm verify:merge` on the final committed revision with a clean working tree. The canonical launcher is `scripts/verify-merge.mjs`, not a benchmark. It runs the complete General (`playwright.config.ts`), nutrition-sync and TransformMate E2E suites through the isolated parallel runner, with four workers by default (`pnpm verify:merge 2` explicitly selects two). Every case receives its own fresh SQLite fixture and Next process; workers have separate filesystem and loopback port groups. Real authentication, assertions, desktop/mobile coverage and rate-limit scenarios remain enabled. Never substitute the shared-database serial `pnpm test:e2e` path for a full pre-merge regression. Occupied ports must be avoided using free dedicated test ports, not by stopping unrelated processes or silently falling back to serial execution. If isolated verification is unavailable, report the blocker instead of starting a slow substitute.

All three complete suites must pass with no skipped cases, flaky retries or omitted scenarios. The runner compares enumerated and executed case identities, verifies per-case reset ledgers and exits nonzero on incomplete coverage. Rerun after any subsequent changes or rebase. Record the final SHA, exact command, per-suite counts and durations from `test-results/merge-verification.json` in the PR or merge report. The command never merges or deploys. CI does not run for PRs and main deployment does not run E2E, so neither replaces this verification. Merge still requires the task's authorization. Targeted `pnpm test:e2e` runs remain available for diagnosis, not as a replacement for `verify:merge`.

One agent = one branch = one Git worktree. Never commit directly to main. Keep PRs narrow; describe changed behavior, contracts/migrations, checks actually run, risks and remaining limitations. Do not commit `.env`, databases, tokens, uploads, test artifacts or production data. Never merge/deploy without the task's authorization. Do not invent product schemas or normalization algorithms.

## Mandatory cleanup after merge

After a task's MR/PR is confirmed merged, always clean up its own resources without waiting for another cleanup request: stop only processes whose ownership belongs to this task, delete its remote and local feature branches, and completely remove its Git worktree and task-owned generated files, including ignored dependencies, builds, synthetic databases, uploads and test artifacts. Use `git worktree remove` with the exact verified task path, then remove an empty task wrapper directory if present. For squash merges, first verify the PR is merged before deleting its local branch. Never touch other agents' worktrees, branches, processes or user data.

Do NOT archive worktrees, create ZIP/tar backups, recovery snapshots or use `archive_worktree` as cleanup. "Clean up" means delete, not preserve an archive. Inspect status first: if uncommitted or unpushed changes are not clearly disposable task-generated files, stop and ask rather than delete or archive them. Confirm the path is absent and no longer registered with Git, and report what was actually deleted. Never report a queued archive operation as completed cleanup. Before merge, retain the worktree needed for the active task; this cleanup rule does not grant merge permission.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
