# Trainer collaboration integration

Owned branch: `feat/trainer-collaboration`. Runtime uses the foundation DB and `trainerAccess`; no second grants table, auth/core changes or migrations.

- OWNER UI: `/settings#trainers`; accept UI: `/invite#TOKEN` (fragment keeps token out of HTTP/access logs and referrers).
- `GET /api/trainers?ownerId=...`: safe trainer list. `POST/DELETE /api/trainers`: `{ ownerId, trainerId }` grant/revoke.
- `POST /api/trainers/invitations`: `{ ownerId, email }` → `{ token, expiresAt }`, no-store. 24-hour one-use token, only SHA-256 stored.
- `POST /api/trainers/invitations/accept`: `{ token, name, password }`, strict input (role rejected), shared app-account password policy of 8–128 characters with no required special characters. Invitation capability is the authorization for this deliberately anonymous entry. Creates TRAINER user, Better Auth credential account and grant in one short transaction, hashing before transaction. Existing email rejects without consuming token. No automatic login or email sending.
- `GET /api/comments?ownerId=...&type=nutrition_day|measurement|workout&targetId=...`: safe CommentDto list.
- `POST /api/comments`: `{ ownerId, target: { type, id }, body, parentId? }` → `{ id }`. Nutrition target ID is ISO calendar date; other targets are IDs. Reply parent must belong to same owner/target and be a root comment.
- `PATCH /api/comments/:id`: `{ ownerId, body }`; `DELETE`: `{ ownerId }`. Author only, permission/grant checked again each call. Deleting a root preserves replies as root comments instead of deleting another author's text.
- UI public entry: `CommentsPanel({ ownerId, target })` from `@/features/comments`. Each target remounts independently so async responses cannot overwrite another target's state.

## Required coordinator integration

1. Include `src/server/db/schema/comments.ts` and `trainer-invitations.ts` in the coordinated Drizzle schema generation, generate SQL/metadata serially and migrate fresh/existing databases. Runtime direct Drizzle table queries do not require adding exports to foundation `schema.ts`; avoid a circular re-export because new files reference its existing `user` table.
2. Supply a server-domain target existence resolver via `configureCommentTargets` from `@/server/comments/targets`. It receives `(ownerId, target)` and must check BOTH owner and target existence against the real server domains. It must be installed on the comments request path, before invoking service, not just in an unrelated page module: Next server bundles can be separate. Missing integration returns 503; missing/foreign targets return 404. No guessed product tables or demo targets.
3. Connect `CommentsPanel` on the three feature pages and add the trainers navigation entry in coordinated shared core work.
4. E2E creates only invitation DDL in disposable `.data/e2e.sqlite` until the generated migration is available. Remove that temporary hook when the schema is integrated. Full successful comments UI E2E remains dependent on target/page integration; direct API grant/isolation and real invitation/password login are covered now.

No production accounts, migrations, deployment or messages are created by this branch. Runtime account creation is the requested owner-controlled flow; tests use synthetic accounts only.

Accept errors use fixed safe codes for invalid input, unavailable capability (invalid/expired/consumed combined), and existing account. Duplicate failure rolls back consumption; UI preserves form input and fragment on failure, clears fragment/password only after validated success. No email/token/password/error internals are echoed.
