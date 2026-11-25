# MCP comment reads

- Objective: expose saved Tempo discussions, including replies, authors and publication/update timestamps. Make discussions visible alongside workout and measurement reads.
- Branch/worktree: `feat/mcp-comments`, `/workspace/tempo-mcp-comments`; no preview server. Only worktree-local synthetic verification databases.
- Owned paths: `src/server/comments/reads.ts`, `src/server/mcp/{comments,data,http,mutations,workouts}.ts`, `tests/integration/mcp-comment-checks.ts`, `tests/integration/mcp-checks.ts`, and MCP documentation.
- Shared/core scope authorized by the requested MCP feature: additive v1 `get_comments` input in `src/contracts/mcp.ts`; internal `comments:read` permission in `src/contracts/permissions.ts` and its `tempo:read` mapping in `src/server/auth/guards.ts`. No new OAuth scope, schema, migration, dependency or UI change.
- Contract: optional exact comment target, existing bounded pagination and signed owner/query-bound cursor. Rows include target, author ID/name, body, parent ID and UTC creation/update times. All saved target types are readable; comment mutations remain forbidden to MCP.
- Visibility: workout and measurement records include reply-inclusive counts and tool-call arguments. Body summaries also signal discussions on measurements between the endpoints. Linked workouts reuse the local discussion; standalone provider records have no Tempo thread.
- Verification tier: Full, because shared contracts and authorization are affected. Required: `pnpm verify:merge` on the final clean commit. No runtime/deployment infrastructure changes; Docker verification does not apply.
- Test budget: 0 added, 0 removed, 0 consolidated cases. Extend the existing real-OAuth integration scenario for thread pagination, author/timestamp fidelity, discovery hints, owner isolation and denied writes. Existing browser journeys remain unchanged.
