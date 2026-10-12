# Owner offline read API

The opt-in browser cache consumes version-1 `src/contracts/offline.ts`. This server layer only reads existing local SQLite records, private photo files and a purpose-limited local TransformMate connection binding. It makes no SDK, provider, refresh-token, media URL, or upstream request. No app data writes, schema, grants, dependencies, keys or credentials are added. Better Auth retains its existing session validation/renewal behavior.

## Routes and authorization

- `GET /api/offline/identity` accepts no query and returns an opaque owner partition, opaque connection generation, OWNER role, server time, session expiry and server expiry observation, plus the current weight policy version.
- `GET /api/offline/snapshot?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts precisely one of each parameter, inclusive at most 30 calendar dates. No owner selector or duplicate/unknown parameter is accepted.
- `GET /api/offline/photos/<opaque>?date=YYYY-MM-DD` accepts precisely one date. The opaque photo key is resolved only in that session owner's photos for that date. It never exposes native YAZIO photo IDs, which embed the owner ID.

All routes derive the owner from the current real session. Anonymous/expired sessions receive 401; TRAINER receives 403 even with a grant. Before local reads and after awaited binding/file work, all three existing `nutrition:read`, `measurements:read`, `workouts:read` permissions are checked with explicit owner scope. Session ID, owner ID, role and expiry must remain valid. Snapshot/photo release rechecks connection generation; photo release also checks that its current local storage key still matches. Responses are `private, no-store`, vary on Cookie and use `nosniff`. Error DTOs contain a fixed code only.

HMAC-SHA256 uses the existing `BETTER_AUTH_SECRET` with distinct purpose strings. Partition binds owner identity; connection generation binds owner, current session ID, YAZIO schedule epoch and local TransformMate configured/stable connection ID. No hash is an authentication credential. Refreshing a TransformMate token retains its stable connection ID and does not invalidate the partition; disconnect/reconnect changes the generation. The tiny `readTransformMateOfflineBinding` helper returns only configured Boolean, connection ID and a noncredential revision after the existing store validates/decrypts local ciphertext, never its credential or profile payload. Missing storage is disconnected; invalid storage fails closed.

The local binding helper also captures a noncredential revision inside the existing token-store serialization. Stable binding mutations advance that revision synchronously before their file write; ordinary refresh with the same connection ID does not. Each final release synchronously fences both this revision and the YAZIO epoch after its last async authorization check. A disconnect/reconnect during that check therefore cannot release an older binding.

The genuine server `expiresAt` observation remains `min(serverNow + 24 hours, minimum session expiry observed across every authorization check)`. It does not determine downloaded local-copy retention. The guard returns the latest validated session while retaining the earlier expiry cap even if a later check renews it. A server response does not prove continued authorization while offline; the browser owns explicit OWNER device opt-in, calendar retention, clock rollback checks, generation fencing and purging on identity/logout/connection changes. Live requests retain the existing server authorization checks.

## Data projection and limits

Snapshots contain safe diary entries/totals; photo metadata; all manual measurement values and notes; in-range raw YAZIO weights with account-specific `unit:kg` / `unitStatus:OWNER_CONFIRMED`; in-range nullable daily step observations; in-range planned workouts and local sessions; available cached TransformMate actual facts/metrics; and already-persisted native TransformMate training snapshots for the current confirmed account binding. Provider IDs, owner IDs, profile/account data, source locators, signed URLs, remote exercise/occurrence/training IDs and token payloads are omitted. Record keys are purpose-separated opaque HMACs. This application’s OWNER explicitly confirmed that they enter YAZIO weights in kg. Projection applies that account assumption without conversion; raw persisted values, NULL SDK units and upstream UUIDs remain unchanged. A preference such as `unitContext:lb` is not treated as evidence or converted. Zero, null and missing dates are preserved. Ambiguous provider weight dates cannot establish range membership, so they are excluded from a dated snapshot.

Photo `availability:'metadata-only'` explicitly means bytes were not checked/downloaded by the snapshot. The browser must track each authenticated photo download separately and must not claim all photos are saved from metadata alone. Server photo responses are at most 10 MiB; the frontend owns its aggregate image quota.

SQL predicates constrain owner and requested dates. Plan rows are restricted to overlapping plan intervals, then only their in-range workouts are projected. Queries fetch at most N+1 rows and throw 413 on overflow: 30 diary/step days, 300 photos/weights/sessions/cached facts, 1000 measurements, 200 overlapping plans. No truncation result is returned. JSON fields are capped at 2 MiB inside SQL; iteration applies a shared 4 MiB raw-payload budget before accumulation/projection; the final safe JSON must also fit 4 MiB. Oversized projections fail explicitly. Native training SQL additionally requires the current confirmed account scope and probes 301 rows against a 300-row cap; absent binding yields no native rows. Disconnected binding may retain that confirmed account’s history. Other owners/accounts and out-of-window dates are excluded. Native rows share the 2 MiB row and 4 MiB total budgets, with explicit overflow errors. No external reads are used to fill gaps or missing cached facts.

Errors: `OFFLINE_ACCESS_DENIED` (401/403), `OFFLINE_INVALID_REQUEST` (400), `OFFLINE_LIMIT_EXCEEDED` (413), `OFFLINE_CONNECTION_CHANGED` (409), `OFFLINE_UNAVAILABLE` (503; absent photo 404). No raw exceptions or record contents are logged or returned.

## Verification

Focused synthetic tests use genuine seven migrations and real Better Auth owner/trainer sessions. They cover strict date/query bounds, trainer denial despite grants, no provider fetch, safe ID/URL stripping, zero/null facts, notes/workouts, post-read session revocation, expired sessions, schedule-epoch changes, SQL row overflow, oversized per-row/cumulative payload, and stable-refresh/disconnect/reconnect/corrupt local binding. No production credentials, private records or provider probes are used.

```sh
pnpm exec vitest run tests/integration/offline-read.test.ts tests/integration/offline-repository.test.ts tests/unit/offline-binding.test.ts
```

## Device local-copy policy

The default-off OWNER switch “Доступно офлайн” saves today and the previous 14 calendar dates in the browser’s current IANA timezone. There are no manual date controls. Snapshot requests use those 15 dates; the server’s strict maximum of 30 remains unchanged. Read and commit prune every dated collection and photo Blob in one IndexedDB transaction, including offline reads. Clock rollback fails closed; zero and null stay distinct.

Downloaded data remains locally viewable without a 24-hour or server-session-expiry cutoff. Genuine server expiry fields are retained without modification, and never extend authorization. Offline revocation cannot be checked; the UI explicitly discloses that a local copy may remain available after a server session ends. Each online entry/reconnect verifies current OWNER identity before revealing a copy. 401/403/409, logout, account/role and provider binding changes retain the durable blocker, generation CAS and all-tab purge. No cached response substitutes for live authorization.

Refresh runs best-effort only while the app is open: startup, online, visible/focus/pageshow events coalesce, one download is in flight, and snapshot attempts are bounded to five-minute cadence. Visibility/pagehide conceals private state and aborts pending reads. No closed-app or iOS background-refresh guarantee is made. The service worker caches only versioned allowlisted static shell assets; opt-in snapshots/Blobs live in IndexedDB. No auth cookies/tokens, SSR/RSC, private API responses, settings/PDF or provider video are cached. Photos have a 50 MiB aggregate quota and honest partial-download notices.

Cache schema 2 and the required `owner-confirmed-kg/v1` policy marker clear old unknown-unit snapshots and photos before read, while preserving the device opt-in preference. Repopulation requires a fresh authenticated identity and snapshot; no old-format compatibility renderer or silent reinterpretation exists. Legitimate account/session/provider generation changes still disable opt-in and clear all tabs.

Targeted tests additionally cover calendar/DST boundaries, atomic offline prune/physical Blob deletion, old-cache invalidation, singleflight/cadence, expired-session local viewing versus online denial, generation isolation and multi-tab purging. Activation, integration CI and deployment remain separately coordinated.

## Native history interop

Required `nativeTrainings` transports literal lifecycle/progress, date/title, fetched/update timestamps, ordered exercise/protocol positions, plan/fact groups, nullable done flags and metric type/unit/value strings. It strips native table IDs, remote training/protocol/exercise IDs and metric keys; only purpose-separated opaque record keys remain. The offline view uses its own readonly Mantine composition, no workout feature import, video, signed URL, mutation or publication controls.

The server obtains the existing `getTransformMateBindingFence` without creating an SDK client. It checks persisted binding currentness before final authorization and synchronously asserts its revision after all awaits immediately before response release. Account scope contributes only inside the opaque generation HMAC and never enters transport. The final session/permission and original YAZIO/TM generation checks remain in force.

A previous snapshot missing required `nativeTrainings` fails the current strict DTO parse: the existing atomic read clears its snapshot and photo Blobs, advances CAS generation and preserves device opt-in. Fresh authenticated identity/snapshot is required to refill; no compatibility renderer exists. Native rows are pruned in the same local-calendar transaction as other records and photos. Tests cover real authorization, current account/date isolation, disconnected history, no provider calls/ID echo, final disconnect/permission races, row/payload overflow, native DOM literal plan/fact metrics, old-cache invalidation and rolling prune.
