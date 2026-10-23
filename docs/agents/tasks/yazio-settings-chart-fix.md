# YAZIO connection goals and measurement tooltip

- Objective: show the two read-only goals inside the YAZIO connection section immediately after account connection content, and prevent the measurement chart tooltip from crashing on inactive/invalid labels.
- Base/branch/worktree: `cd276f1`, `codex/yazio-settings-chart-fix`, `/Users/n.nafranets/.codex/worktrees/yazio-goals-settings-chart/yazio-dashboard`.
- Owned scope: settings composition, compact goals presentation/navigation order and measurement chart date formatting; no schema/contracts/auth/navigation-framework changes.
- UI acceptance: two compact definition columns within existing 600px YAZIO width, labels `Цель шагов` and `Цель калорий`, unavailable `Не установлена`; no new card, title, source/helper explanation or editing. Keep `#goals` and keyboard focus; navigation entry follows YAZIO connection before sync. Check 320/390px and desktop, light/dark.
- Chart acceptance: reproduce actual initial-render crash first; reject missing, blank, nonfinite and out-of-range tooltip dates without fabricating 1970. Preserve numeric UTC calendar coordinates, distinct same-day observations, neutral series, units and existing connected-gap handling. Validate initial render, hover, leave and weight/circumference switching using synthetic data.
- Data/access: no production data or credentials; existing authorization, transport and write lifecycle unchanged.
- Verification tier: Full because two runtime feature paths are affected. Root runs final `pnpm verify:merge` on clean commit after independent review. Focused format/lint/typecheck during development.
- Test budget: zero new cases; extend an existing smoke assertion if it meaningfully protects the reproduced chart failure. Do not change suite budgets.
- Preview: temporary local demo route, port 3348 bound to 127.0.0.1; remove before commit and stop owned preview/browser. Evidence lives outside worktree at `/tmp/tempo-settings-chart-evidence-20261024`.
