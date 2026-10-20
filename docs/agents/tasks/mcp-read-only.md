# Read-only MCP v1

- Objective: six owner-only MCP tools over existing saved application data, OAuth and operational documentation.
- Verification tier: **Full**, chosen before implementation because auth, shared contracts, a dependency and an additive SQLite migration change.
- Branch/worktree: `codex/mcp-read-only`, `/private/tmp/tempo-mcp-v1`; isolated synthetic databases only.
- Owned paths: `src/server/mcp`, `src/app/api/mcp`, MCP metadata and consent/login routes, `src/contracts/mcp.ts`, operator CLI and docs.
- Coordinated core scope required by this task: OAuth plugin and tables/migration, request-bound read authorization, owner selection, read-only step-goal accessor, login return destination, dependencies and operator CLI bundling. Existing browser cookie authorization and read/write permissions remain mandatory.
- Contract: version 1, six named tools, ISO calendar dates, maximum 366 days, compact summary by default, up to 31 days for detailed records; signed query/account-bound cursors and bounded responses.
- Excluded: anamnesis, medical/PDF/file access, credentials, writes, new synchronization, offline-cache changes and unrelated refactoring.
- Demo strategy: none at runtime; synthetic test records in migrated temporary SQLite.
- Schema: additive OAuth-provider tables in the existing SQLite database; generated SQL and snapshot; existing production migrations untouched.
- Test budget: 0 added cases, 0 removed, 0 consolidated. Extend existing server-authorization case with real Better Auth OAuth and official MCP client; pin migration-upgrade checkpoints by tag. No new browser case.
- Required acceptance: protocol initialize/discovery/tools; OAuth code+PKCE/refresh/revocation, owner-only and IDOR; completeness/zero/empty distinctions and parity with analytics; pagination/range/size/rate bounds. Full verification on clean committed SHA, image build and disposable Docker smoke.
- Merge/deploy: not authorized by this task.
