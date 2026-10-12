# TransformMate owner connection

The OWNER connects from settings with a Firebase API key and refresh token. Runtime
never reads provider credentials from environment variables. The sole persistent
credential location is `TRANSFORMMATE_TOKEN_FILE`, defaulting to
`./.data/private/transformmate-token.json` locally and `/app/data/transformmate-token.json`
in the production container.

The file is an AES-256-GCM authenticated envelope. HKDF derives its key from the
existing `BETTER_AUTH_SECRET` with a distinct TransformMate purpose and owner ID;
AAD authenticates purpose, owner and envelope generation. Credentials, safe account
profile and Firebase UID/project binding are encrypted. Files are created as 0600,
the containing directory as 0700, and updates use exclusive temporary files plus
atomic rename. The supported single Node process serializes writes per resolved
path; every mutation checks its loaded generation. Keep the same secret and owner
ID when restoring the encrypted file. Secret rotation requires explicit recovery
or reconnect; plaintext/legacy fallback is absent.

Connect validates Firebase refresh and `users/me` before replacing an existing
connection. Its bounded credential input is never echoed in errors or logs. Failed
validation/upstream requests preserve the existing file. Pending unattempted links
may exist before first connection. Attempted links, remote IDs and durable history
require an existing verified account binding; another account cannot inherit them.
A disconnected tombstone retains that binding and Firebase identity. An old
unbound attempted link cannot be silently attributed to the new account.

Logout keeps the connection. Disconnect writes an authenticated encrypted tombstone,
invalidates cached clients, and preserves workouts, facts and history; it does not
revoke the upstream Firebase refresh token. Late connect/refresh writes are rejected.
Runtime fences before/after token acquisition, upstream requests and complete client
methods. Firebase refresh rotation is persisted before publishing the candidate
ID token or refresh token. Every token use checks its verified UID/project. Failed
persistence cannot leave a cached successful token.

The runtime API is asynchronous and owner scoped:
`getTransformMateClient(ownerId)`, `isTransformMateConfigured(ownerId)` and
`getTransformMateConnectionFence(ownerId)`. A fence provides `assertCurrent()` and
a stable `generation` connection UUID. This UUID remains stable during token rotation
and changes on reconnect. Persisted workout authorization must use the verified
account binding when safely recovering a same-account reconnect; the UUID alone is
only an operation fence.

`GET /api/transformmate/status` and POST `connect`, `check`, `disconnect` enforce
OWNER authorization; mutations additionally require the configured same origin.
POST disconnect and check accept only `{}`. Responses use `private, no-store` and
safe account/status DTOs. Security E2E must use real auth sessions; unit tests use
synthetic token/profile responses and temporary encrypted files only.
