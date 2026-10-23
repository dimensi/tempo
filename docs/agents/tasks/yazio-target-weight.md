# YAZIO target weight

- Objective: show saved YAZIO target weight beside calorie/step goals in settings and expose it through MCP `get_profile`, with missing/recorded coverage.
- Branch: `codex/yazio-target-weight`; isolated worktree `yazio-target-weight/yazio-dashboard`, based on `8846595`. No preview server or production credentials.
- Coordinated ownership: DailyGoals v1 contract, YAZIO adapter/repository, goal schema/generated migration, settings goal block, MCP reads/descriptions, associated docs and existing integration scenarios.
- Contract: nullable decimal-string `weight`, per owner/date; kg uses the existing account-specific owner confirmation. Missing/zero upstream goals map to null. No history inference or automatic backfill.
- Authorization: existing session, owner and explicit trainer-grant checks remain mandatory and unchanged; MCP remains OWNER-only. Shared read validation receives the extended goals contract.
- Storage: reviewed additive migration 0024 adds nullable TEXT `weight`; existing calorie/step rows are preserved with weight null. Fresh and existing synthetic databases only.
- Verification tier recorded before implementation: Full, because shared contract and schema change. Final clean-commit `pnpm verify:merge` is required. No runtime infrastructure change.
- Tests: zero added, removed or consolidated cases; extend existing migration, nutrition-sync and MCP scenarios for data preservation, dated persistence, failed-read retention and missing/recorded coverage. No new E2E.
- Focused checks: typecheck, changed-file ESLint/Prettier, migration and nutrition-sync integration cases, existing authorization/MCP integration case, fresh disposable `pnpm db:migrate`, `git diff --check`. Final Full report belongs to the release coordinator.
