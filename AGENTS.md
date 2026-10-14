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

Run: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. For infra changes build the image and run the disposable Docker smoke test. No fictional success scripts or claimed unrun checks.

MANDATORY BEFORE EVERY MERGE INTO `main`: run all three complete E2E suites on the final revision being merged: `pnpm test:e2e`, `pnpm test:e2e --config tests/nutrition-sync/e2e.config.ts`, and `pnpm test:e2e --config tests/transformmate-sync/e2e.config.ts`. All three must pass; do not merge if any suite fails, is skipped, or has not been run. Rerun them after any subsequent changes or rebase. Record the tested commit SHA, commands and results in the PR or merge report. CI does not run for PRs and main deployment does not run E2E, so neither replaces this mandatory pre-merge verification. Merge still requires the task's authorization.

One agent = one branch = one Git worktree. Never commit directly to main. Keep PRs narrow; describe changed behavior, contracts/migrations, checks actually run, risks and remaining limitations. Do not commit `.env`, databases, tokens, uploads, test artifacts or production data. Never merge/deploy without the task's authorization. Do not invent product schemas or normalization algorithms.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
