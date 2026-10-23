# TransformMate synchronization repair

Scope: server TransformMate client and workout synchronization, versioned sync/read
contracts, workout status UI, focused existing integration scenario. Separate from
`codex/catalog-play-button`; no deployment or production workout mutation is part of
implementation verification.

Verification tier: Full. Provider writes, durable recovery and shared sync contracts
require `pnpm verify:merge` on the clean final commit. No new test cases: extend the
existing provider recovery integration case with custom exercise and execution
recovery assertions. Keep existing authorization and offline write integrity checks.

Acceptance: manual exercises are created with a durable account-scoped provenance
marker and recovered through reads after an ambiguous POST; an ambiguous write is
never blindly repeated. Results and lifecycle are published for owner-authorized
local workouts, preserving unrelated/externally edited remote data. Refresh success
must account for linked synchronization state; its failure must remain visible next
to a local workout. Capture provider timestamps durably; older local records have no
historical execution timestamps, so any backfill time must be disclosed explicitly.

Live protocol evidence (2026-10-23): APK 2.1.7 create DTO and `POST /exercises/`
validated with disposable exercise 33590. A second disposable exercise 33591 and
training 2298940 verified weight/reps fact values, `is_done`, started/finished and
progress=done. DELETE returned 204; exercise absence returned 404. No real workout
was changed. Custom exercise detail has metrics=[]; its training explicitly accepts
measure IDs 3 (weight) and 4 (reps).
