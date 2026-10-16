# Feature task template

- Objective and user-visible acceptance criteria:
- In scope / deferred:
- Branch / worktree / dev port / local DATABASE_URL:
- Owned paths:
- Shared/core changes requiring coordination:
- Contract version and agreed inputs/outputs:
- Authentication permission and owner data scope:
- If client reads are affected: follow ADR 002; no cold boot/shell guarantee, cache only loaded resources, central validation/auth-error handling, stale offline trainer data accepted until detected revoke:
- Demo fixture strategy (development only):
- Schema/migration changes and backup needs:
- Unit/integration/E2E checks:
- PR summary, executed verification and remaining limits:

A task is ready when dependent contracts and ownership are agreed. Use narrow, reviewable implementation; do not invent upstream payload details or expand the product beyond acceptance criteria.
