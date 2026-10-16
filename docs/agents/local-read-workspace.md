# Local read workspace task

- Verification tier: Full.
- Base: origin/main; branch: codex/local-read-workspace.
- Owned: shared browser read/lifecycle/navigation, app composition and read endpoints, necessary feature adapters, related tests/docs.
- Shared/core changes are explicitly authorized by the implementation request.
- Interface: typed read descriptor, resource state and refresh; existing product DTOs and permissions.
- Scope: authenticated owner or explicitly granted trainer; synthetic fixtures only.
- No SQL migrations, dependencies, calculations or new product features.
- Acceptance: one ordinary UI across connectivity and cold launch; local reads before network; drafts and mounted state retained; synchronous conceal/purge on security changes.
- Checks: unit/integration, complete verify:merge and production offline suites on final clean committed SHA.
- Delivery: PR only; no merge/deploy.
