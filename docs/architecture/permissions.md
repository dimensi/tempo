# Permissions and data scope

Better Auth provides password hashing, server-side sessions, HttpOnly cookies and HTTPS Secure cookies. Sessions live in SQLite; client cookie caching is disabled so revoked access and role changes are evaluated server-side. Registration is disabled and role cannot be provided through user input.

| Permission           | OWNER | TRAINER          |
| -------------------- | ----- | ---------------- |
| nutrition:read       | yes   | with owner grant |
| nutrition:write      | yes   | no               |
| measurements:read    | yes   | with owner grant |
| measurements:write   | yes   | no               |
| workouts:read        | yes   | with owner grant |
| workouts:plan        | yes   | with owner grant |
| workouts:log         | yes   | with owner grant |
| comments:write       | yes   | with owner grant |
| reports:export       | yes   | with owner grant |
| yazio:manage         | yes   | no               |
| transformmate:manage | yes   | no               |
| trainers:manage      | yes   | no               |

`workouts:plan` covers workout structure; `workouts:log` covers execution and results. With an owner grant, a trainer has the same workout management actions as the owner: create, edit exercises and sets during execution, start, complete, resume, delete and manage personal workout videos. Both roles use the same durable workout write queue when disconnected. Each send checks the current session and owner grant; account partitions, revision conflicts and idempotent receipts remain enforced. Measurement writes and external-service connection management remain owner-only.

`src/contracts/permissions.ts` defines capabilities. `src/server/auth/guards.ts` enforces authentication, capability and subject scope. `requireSession()` is a page gate; data handlers still call `authorize(request.headers, permission, ownerId)` and filter every query by the authorized owner ID. Missing ownerId fails closed for all data permissions. Global owner-only configuration actions may omit it. OWNER cannot access another owner's subject. TRAINER needs `trainer_access(trainerId, ownerId)`; it is not enough to have a trainer role.

One OWNER is enforced by a partial unique index. CLI creates users transactionally using Better Auth's standard hashPassword and a credential account. It creates no session and exposes no bootstrap HTTP endpoint. `GRANT_OWNER_ACCESS=true` explicitly consents to access for a new trainer; no grant is the default.

Owners manage trainer access at `/settings#trainers`: create an invitation for an unused email, copy its `/invite#…` link, and revoke or restore access with the displayed controls. Acceptance creates a TRAINER account and its owner grant together; invitations expire after 24 hours and can be used once. Open registration remains disabled. Revocation removes the grant, preserving the trainer account and history; subsequent scoped requests are denied. Previously downloaded data may remain readable until the client discovers the revoke. This is accepted, including while disconnected or after BFCache restore; no immediate remote erasure is promised. The common API handler logs out and clears local state after a session-wide denial/revoke. An action-level 403 remains an action error. These simplified client semantics are accepted in [ADR 002](../decisions/002-resilient-client-reads.md) and implemented by the common client/server API layer. Settings management is owner-only, so the shared desktop/mobile navigation omits that entry for TRAINER. Direct URLs and APIs still enforce server permissions.

Do not grant role changes through generic update-user endpoints. Provider credentials stay in private server-side encrypted stores and never enter session payloads. Connection management/status is owner-only and exposes safe account/status DTOs, never credentials.

The deployment uses one Next.js process; Better Auth in-memory rate limiting applies within this process. Strong secret, correct HTTPS origin and trusted origin checks are mandatory. Do not disable origin/CSRF checks to accommodate a proxy. Keep the auth URL equal to the external tunnel URL.

Medical access is owner-controlled through `trainer_access.anamnesis_access` (default false). One switch grants all existing and future medical markers, source PDFs and medical reports together. Both this flag and the current base owner/trainer grant are required by `authorize` for every `anamnesis:*` trainer operation; owners retain full access to their own data. Trainer writes and medical MCP access remain denied. Original and report PDF reads and asynchronous report generation recheck authorization after storage/rendering before returning data. Disabling medical access preserves patient data and files; deleting base access removes the medical flag too. Existing selective marker or document consent is migrated to this single grant for the same owner/trainer pair.
