# Mobile navigation task

- Objective: four mobile destinations, ordinary More page, brand/actions header and in-content mobile title; preserve desktop sidebar.
- Branch: `codex/mobile-navigation`; worktree-local synthetic database only.
- Follow-up: cap mobile bar at 400px, horizontal section navigation, header role badge, isolated sticky layers, trainer spacing and account-scoped downloaded-file usage/removal. Removal touches only saved files and preserves cached reads, video drafts and pending writes.
- Owned paths: shared layout/navigation components, messages, dashboard More and Settings routes, DESIGN.md and this task record.
- Shared/core changes: explicitly authorized by the approved mobile navigation plan. No API/contract/schema changes.
- Permissions: existing authenticated dashboard layout and server owner/grant checks; trainers see local appearance settings only.
- Cache/write lifecycle: unchanged; reuse existing logout including pending-write confirmation.
- Verification: Full (`pnpm verify:merge` on clean final commit); visual mobile/desktop inspection and Impeccable detector. Zero new, removed or consolidated test cases.
- Delivery: no merge or deployment authorized.
