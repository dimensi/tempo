# Exercise catalog and sharing

- Objective: expose the exercise catalog in desktop nested navigation and mobile More; share stable authenticated exercise pages through messengers.
- Branch/worktree: `feat/exercise-sharing`, `/Users/n.nafranets/projects/yazio-exercise-sharing`.
- Owned paths: workout feature/routes, shared navigation, exercise-link helper, login return handling and narrow Proxy, common read error classification, existing browser smoke.
- Coordinated core changes: navigation and login return are explicitly part of the approved plan; no schema, dependency or deployment changes.
- Contracts: existing exercise v1 API; share URL `/workouts/catalog/[id]` contains no owner or sender identity. Server resolves current accessible owner and APIs enforce `workouts:read`.
- Reads: existing account-scoped cache; preserve loaded data on network failure. No shell or cold offline guarantee. No pending-write changes.
- Fixtures: existing synthetic authenticated browser smoke, never production data.
- Verification: Full, `pnpm verify:merge` on final clean commit; zero new, removed or consolidated cases. Extend existing smoke for links and login return.
- Delivery: local feature commit, no merge or deployment authorized.

## Catalog card refinement

- Replace the two large card buttons with two distinct 44px icon buttons (copy and share) beside muscle badges; retain page actions and clipboard fallback.
- Verification tier: Isolated, bounded workout UI only. Formatting, component ESLint, typecheck, production build and existing authenticated browser smoke in a disposable checkout, leaving the live preview and local data running.
- Cases added/removed/consolidated: 0/0/0; extend the existing smoke to exercise the compact copy control and fallback.

- Follow-up: keep an 8px gap between icon buttons; show copy confirmation and share failures through the existing Mantine Notifications provider, preserving manual-copy fallback. Isolated verification; no new/removed/consolidated test cases.
