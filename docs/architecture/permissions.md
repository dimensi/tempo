# Permissions and data scope

Better Auth provides password hashing, server-side sessions, HttpOnly cookies and HTTPS Secure cookies. Sessions live in SQLite; client cookie caching is disabled so revoked access and role changes are evaluated server-side. Registration is disabled and role cannot be provided through user input.

| Permission         | OWNER | TRAINER          |
| ------------------ | ----- | ---------------- |
| nutrition:read     | yes   | with owner grant |
| nutrition:write    | yes   | no               |
| measurements:read  | yes   | with owner grant |
| measurements:write | yes   | no               |
| workouts:read      | yes   | with owner grant |
| workouts:plan      | yes   | with owner grant |
| comments:write     | yes   | with owner grant |
| reports:export     | yes   | with owner grant |
| yazio:manage       | yes   | no               |
| trainers:manage    | yes   | no               |

`src/contracts/permissions.ts` defines capabilities. `src/server/auth/guards.ts` enforces authentication, capability and subject scope. `requireSession()` is a page gate; data handlers still call `authorize(request.headers, permission, ownerId)` and filter every query by the authorized owner ID. Missing ownerId fails closed for all data permissions. Global owner-only configuration actions may omit it. OWNER cannot access another owner's subject. TRAINER needs `trainer_access(trainerId, ownerId)`; it is not enough to have a trainer role.

One OWNER is enforced by a partial unique index. CLI creates users transactionally using Better Auth's standard hashPassword and a credential account. It creates no session and exposes no bootstrap HTTP endpoint. `GRANT_OWNER_ACCESS=true` explicitly consents to access for a new trainer; no grant is the default.

Revocation for an operator: remove trainer_access and/or that user's sessions from SQLite in a reviewed operator transaction; an owner-facing management UI is deferred. Do not grant role changes through generic update-user endpoints. YAZIO secrets live in server configuration/token files and never in session payloads. The status endpoint returns only a configured boolean and is owner-only.

The deployment uses one Next.js process; Better Auth in-memory rate limiting applies within this process. Strong secret, correct HTTPS origin and trusted origin checks are mandatory. Do not disable origin/CSRF checks to accommodate a proxy. Keep the auth URL equal to the external tunnel URL.
