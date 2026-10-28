# Refresh retained personal-video lists

- Objective: reopening «Мои видео» retries a failed list read and refreshes recordings changed elsewhere, without stopping active uploads.
- Scope/ownership: `src/features/workouts/workout-videos.tsx`, the existing `tests/smoke/core.spec.ts` journey and this task note. No shared contracts, schema, migrations, dependencies or authorization changes.
- Branch/worktree: `fix/video-list-reopen`, `/workspace/tempo-video-refresh`. No persistent preview or user database; browser checks use the disposable `.data/e2e.sqlite`.
- Implementation: separate visibility-triggered list reads from scope/session cleanup. Closing a panel cancels only that read; queue lifetime, keys and session generation remain unchanged. Preserve current rows on refresh failure and retain central API authorization handling.
- Verification tier: Full because effect lifetimes and cancellation interact with retained uploads. Run `pnpm verify:merge` on the clean final commit. Extend the existing browser smoke with failed first list read → restored network → close/reopen → successful read, followed by its existing multi-upload/tab/close journey. No new test cases.
- Fixtures/access: existing synthetic workout and camera video with real owner/trainer test authentication; no production data or new permissions.
