# Exercise history and progress

- Objective: previous completed sets beside each exercise, explicit set reuse, a shared history drawer and an exercise overview in Analytics.
- Branch: `nnafranets/feature/exercise-progress`; isolated worktree `exercise-progress/yazio-dashboard`. Development preview port 3107, `DATABASE_URL=file:./.data/development.sqlite`.
- Ownership: workouts UI/server, analytics integration, coordinated shared progress components, read contracts/descriptors/cache whitelist and existing integration scenarios. No database schema or dependency changes.
- Interfaces: version 1 progress summary/history reads, exact TransformMate catalog identity, owner-scoped `workouts:read` for owners and granted trainers. MCP remains owner-only.
- Sources remain distinct. Only completed comparable scalar sets contribute to statistics; native/linked original metrics remain visible. Missing weight is not zero.
- Cached reads use ADR 002 and the existing shared read lifecycle. No route shell, warmup or write-queue changes.
- Verification tier: Full because two features, shared contracts and cached reads change. Zero added/removed/consolidated test cases; extend existing integration assertions. Run `pnpm verify:merge` on a clean final commit and inspect desktop/mobile together.
- No merge or deployment requested. Keep the review worktree until the user authorizes its release.
