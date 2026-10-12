# Owner offline read API

The opt-in browser cache consumes version-1 `src/contracts/offline.ts`. This server layer only reads existing local SQLite records, private photo files and a purpose-limited local TransformMate connection binding. It makes no SDK, provider, refresh-token, media URL, or upstream request. No app data writes, schema, grants, dependencies, keys or credentials are added. Better Auth retains its existing session validation/renewal behavior.

## Routes and authorization

- `GET /api/offline/identity` accepts no query and returns an opaque owner partition, opaque connection generation, OWNER role, server time, session expiry and offline expiry.
- `GET /api/offline/snapshot?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts precisely one of each parameter, inclusive at most 30 calendar dates. No owner selector or duplicate/unknown parameter is accepted.
- `GET /api/offline/photos/<opaque>?date=YYYY-MM-DD` accepts precisely one date. The opaque photo key is resolved only in that session owner's photos for that date. It never exposes native YAZIO photo IDs, which embed the owner ID.

All routes derive the owner from the current real session. Anonymous/expired sessions receive 401; TRAINER receives 403 even with a grant. Before local reads and after awaited binding/file work, all three existing `nutrition:read`, `measurements:read`, `workouts:read` permissions are checked with explicit owner scope. Session ID, owner ID, role and expiry must remain valid. Snapshot/photo release rechecks connection generation; photo release also checks that its current local storage key still matches. Responses are `private, no-store`, vary on Cookie and use `nosniff`. Error DTOs contain a fixed code only.

HMAC-SHA256 uses the existing `BETTER_AUTH_SECRET` with distinct purpose strings. Partition binds owner identity; connection generation binds owner, current session ID, YAZIO schedule epoch and local TransformMate configured/stable connection ID. No hash is an authentication credential. Refreshing a TransformMate token retains its stable connection ID and does not invalidate the partition; disconnect/reconnect changes the generation. The tiny `readTransformMateOfflineBinding` helper returns only configured Boolean, connection ID and a noncredential revision after the existing store validates/decrypts local ciphertext, never its credential or profile payload. Missing storage is disconnected; invalid storage fails closed.

The local binding helper also captures a noncredential revision inside the existing token-store serialization. Stable binding mutations advance that revision synchronously before their file write; ordinary refresh with the same connection ID does not. Each final release synchronously fences both this revision and the YAZIO epoch after its last async authorization check. A disconnect/reconnect during that check therefore cannot release an older binding.

Offline expiry is `min(serverNow + 24 hours, minimum session expiry observed across every authorization check)`. The guard returns the latest validated session while retaining the earlier expiry cap even if a later check renews it. A server response does not prove continued authorization while offline; the browser worker owns opt-in, clock/expiry enforcement, generation fencing and purging on identity/logout/connection changes.

## Data projection and limits

Snapshots contain safe diary entries/totals; photo metadata; all manual measurement values and notes; in-range raw YAZIO weights with literal `unit:null`; in-range nullable daily step observations; in-range planned workouts and local sessions; and available cached TransformMate actual facts/metrics. Provider IDs, owner IDs, profile/account data, source locators, signed URLs, remote exercise/occurrence/training IDs and token payloads are omitted. Record keys are purpose-separated opaque HMACs. Unknown mass preferences remain metadata and never become kg. Zero, null and missing dates are preserved. Ambiguous provider weight dates cannot establish range membership, so they are excluded from a dated snapshot.

Photo `availability:'metadata-only'` explicitly means bytes were not checked/downloaded by the snapshot. The browser must track each authenticated photo download separately and must not claim all photos are saved from metadata alone. Server photo responses are at most 10 MiB; the frontend owns its aggregate image quota.

SQL predicates constrain owner and requested dates. Plan rows are restricted to overlapping plan intervals, then only their in-range workouts are projected. Queries fetch at most N+1 rows and throw 413 on overflow: 30 diary/step days, 300 photos/weights/sessions/cached facts, 1000 measurements, 200 overlapping plans. No truncation result is returned. JSON fields are capped at 2 MiB inside SQL; iteration applies a shared 4 MiB raw-payload budget before accumulation/projection; the final safe JSON must also fit 4 MiB. Oversized projections fail explicitly. No external reads are used to fill gaps or missing cached facts.

Errors: `OFFLINE_ACCESS_DENIED` (401/403), `OFFLINE_INVALID_REQUEST` (400), `OFFLINE_LIMIT_EXCEEDED` (413), `OFFLINE_CONNECTION_CHANGED` (409), `OFFLINE_UNAVAILABLE` (503; absent photo 404). No raw exceptions or record contents are logged or returned.

## Verification

Focused synthetic tests use genuine seven migrations and real Better Auth owner/trainer sessions. They cover strict date/query bounds, trainer denial despite grants, no provider fetch, safe ID/URL stripping, zero/null facts, notes/workouts, post-read session revocation, expired sessions, schedule-epoch changes, SQL row overflow, oversized per-row/cumulative payload, and stable-refresh/disconnect/reconnect/corrupt local binding. No production credentials, private records or provider probes are used.

```sh
pnpm exec vitest run tests/integration/offline-read.test.ts tests/integration/offline-repository.test.ts tests/unit/offline-binding.test.ts
```

Service worker, IndexedDB, offline UI, activation, integration CI and deployment are separate coordinated work. This server API alone does not activate offline storage.
