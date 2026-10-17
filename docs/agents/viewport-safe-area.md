# Viewport safe-area correction

- Objective: emit `viewport-fit=cover`, preserve zoom, and keep shell/navigation/dialog controls inside nonzero device insets.
- Owned paths: root layout/global styles, shared shell/section-navigation/bottom-sheet and design documentation.
- Shared/core changes: viewport and safe-area integration only. No API, auth, database or cache contract changes.
- Verification tier: Full because the root viewport and shared layout affect every route. Run `pnpm verify:merge` on the clean final commit; add/remove/consolidate zero test cases. Manually inspect emitted viewport and geometry with zero and simulated nonzero insets; do not claim physical-iPhone validation.
- Local setup: isolated worktree and synthetic worktree-local database, never production credentials/data.
