# TransformMate workout integration

Saving persists the local plan and automatically publishes eligible catalog workouts. Published
workouts can be updated while the latest observed remote training is unstarted, unfinished,
idle and has no factual values or done flags. Started/completed workouts and observed external
conflicts remain read-only. The upstream API has no verified atomic conditional-write primitive:
a concurrent external change after the last GET and before the full PATCH can still be overwritten.
The user accepted this residual race and avoids editing both applications simultaneously. This
is a practical guarded update, not an atomic exclusion guarantee.

The workout editor keeps manual plans and sessions and adds catalog exercises with a local
occurrence UUID and optional exercise comment. Dates, array order, repetitions and nullable kg
remain explicit. Every linked exercise must support the verified weight/reps straight metrics.
Mixed manual/catalog workouts remain local with a visible unsupported status; there is no partial
publication. The save button persists the local plan and automatically publishes eligible new or safely editable published
workouts, without a separate confirmation. Copying a plan shifts calendar dates, generates new
workout/occurrence IDs and copies planned sets/comments only. Recurring plans and uploaded videos
are outside this change.

The dashboard uses one day-oriented workout stream rather than separate plan/history modes. Each
workout shows ordered exercises and planned/performed sets together; TransformMate is a source and
sync status on the workout, not a different editing mode. OWNER can record local facts, while a
granted TRAINER can prepare plans. Provider-native workouts are read-only cards and expose no
start, finish or fact mutation controls.

## Persistence and recovery

Migration `0005_ambitious_whirlwind` adds only `workout_transformmate_links`. Owner FK and scoped
unique indexes enforce one link per owner/plan/workout and one remote ID per owner. Local plan
deletion keeps links, immutable original plan snapshots and imported actual results. Deleting the
owner removes their records. Orphan history still requires the current owner or trainer grant.

Migration `0007_third_ultragirl` adds only `workout_transformmate_native`. It stores a bounded,
validated read-only projection with a stable opaque account scope, provider training ID, local
revision and freshness timestamps. Owner/account/provider uniqueness prevents duplicate cards;
date indexing supports local filtering and cursor pagination. Switching provider accounts retains
old rows but excludes them from the active scope. Disconnect keeps the last account binding so
cached history remains readable under normal owner/trainer authorization. Missing or incomplete
provider listings never delete cached history, and owner deletion cascades it.

Plan data and initial/reconciled publication intents commit in one short SQLite transaction.
While `attempted=false` and the remote ID is null, edits replace the pending snapshot under
revision CAS, including plans saved while credentials were absent. The snapshot freezes at the
durable attempt claim. Create/update/delete and sync claims share the owner queue; plan permission
is checked again after waiting, before local persistence. HTTP starts after commit.
A client-supplied UUID `Idempotency-Key` on plan creation uses the plan row itself as
a durable receipt: a matching validated payload hash returns the same plan, a changed or foreign
payload returns 409. Request JSON is limited to 8 MiB before parsing; provider JSON to 16 MiB.

Before POST, the link uses local revision CAS to persist an attempted/unknown claim and a unique
description marker. A crash, timeout, invalid response or failed post-write GET never causes a
second POST. Verification reads the list for exactly one marker match, then owned detail and the
expected ordered plan projection. A known returned remote ID is persisted before reading detail.
Zero matches do not prove absence; multiple matches remain conflicting. Failed reads preserve the
previous actual results and successful check timestamp. A restart resumes durable pending intents;
an already attempted create only verifies. Ownership/grants are checked around network operations.
A coherent runtime client/fence snapshot protects every engine operation. Plan permission is
rechecked after asynchronous connection checks immediately before synchronous SQL persistence.

The supported runtime remains one Next.js process with SQLite WAL. In-process owner serialization
and persisted CAS prevent competing local requests from claiming the same intent. No network
request runs in a database transaction.

## Remote edits and actual results

The verified write API sends a full training DTO. A single guarded PATCH supports changing date,
plan/workout title, comments, weights/repetitions, exercise order, adding/removing/replacing catalog
exercises, and adding/removing planned sets. Straight weight/repetition metrics are required for
all exercises; manual/catalog mixes and unsupported techniques remain local with an explicit
status. The integration never deletes remote workouts. Removing a local workout preserves its
remote training and local linked history.

Each update retains immutable original history and a separate last verified published snapshot.
Local save and a bounded pending update intent commit together. Preflight reads current detail,
checks owner/account/description marker and the previous semantic fingerprint, validates lifecycle
and every fact metric, and builds the whole DTO from fresh remote metadata and empty fact
placeholders. Exercise occurrences are mapped by local UUID and current remote semantics;
fact IDs are not assumed stable. Permission, connection epoch and local revision are checked again
before sending. Unknown is persisted before one PATCH; 401, timeout or malformed response never
trigger an automatic write replay. A read verifies the desired projection afterwards. On restart,
an unknown intent only reads: the previous projection remains unknown, a different projection
conflicts, and a matching desired projection confirms publication. No blind rollback or retry is
performed. Later local edits do not replace an unresolved unknown intent.

The last observed started/completed state blocks writes even if its planned projection matches.
An idle training with factual values also blocks writes and displays a conflict. Results remain
visible alongside the last published plan; editing the local plan cannot relabel performed facts.
Observed external edits cause a conflict rather than an overwrite. These checks cannot close the
last GET→PATCH race described above, and successful post-verification cannot prove no concurrent
fact was lost during that window.

Actual sets come exclusively from current `metrics[type=fact]`, with explicit order, done flag,
metric type and original string values. Historical `best_result`/`last_results` are not actuals.
Fact IDs are never treated as stable identity. Initial correspondence uses the complete ordered
semantic projection; when that projection changes, ambiguous occurrence keys become null. The
UI additionally checks catalog exercise ID and local occurrence key before placing a result beside
a planned set. Unknown/range/empty values are retained without invented numeric results. Manual
sessions and their original snapshots are unchanged.

`GET /api/workouts/transformmate?ownerId=…&from=…&to=…&limit=…` reads scoped local linked and
provider-native history. Cursor pagination is local; the upstream SDK exposes one complete summary
array rather than verified date/page parameters. Same-origin POST first refreshes linked results
and verifies ambiguous attempts, then reads at most 20 native details for the requested page.
Native records never create a local plan/link/intent and never enter the provider write engine.
Eligible never-attempted local intents can still publish under current plan permission. The visible
dashboard coalesces load/focus/visibility/60-second refreshes; there is no recurring workout
creation or new background scheduler.

## Catalog and video

Owner/granted trainer routes return safe catalog and detail DTOs. Search returns at most 50 items.
The short catalog, details and media use the [permanent server replica](transformmate-replica.md).
Search filters the local index. Background jobs persist their progress, refresh with
25–35 day jitter and respect a shared failure cooldown.
The verified short payload guarantees name/metrics only. Alternative names are searchable after
that exercise detail has been requested during the current cache lifetime; the server worker gradually enriches the whole catalog; unsupported group fields
are not invented.
The server checks detailed straight-metric capability before publication. Provider responses and
media URLs never reach the browser. Read-only verification found 1 098 catalog items and direct
MP4 variants at the exact HTTPS host `kinescopecdn.net`. Anonymous HEAD returned 200 video/mp4
with byte ranges; GET `bytes=0-1023` returned 206 and the expected Content-Range. This verifies
media transport, not a real account write or physical-phone playback.

Video.js 8.24.1 is pinned. Opening the description does not fetch media; showing the player still
uses `preload: none` and no autoplay. Play, seeking, speed and fullscreen work in synthetic browser
tests. Scoped controls have 44 px targets, and speed stays available at mobile widths. Selection
changes/unmount dispose the player. Chromium mobile emulation is not a physical iPhone check.

The private same-origin video route checks current access, prefers the stored S3 object for each
HEAD/GET/seek request. Upstream fallback uses validated metadata, allows only the exact CDN host and MP4 format, forwards one validated Range,
and streams rather than buffering the entire video. It rejects redirects, cancels on client abort
or revoked authorization before response, validates 206/416 headers, and sends private no-store.
No Firebase/JWT credentials, provider cookies, signed URLs or upstream errors are forwarded/logged.
The worker gradually downloads catalog videos; playback prefers the stored copy.

Observed links have `expires`/`sign` query fields. Their duration is provider-controlled and is not
assumed stable or hardcoded. Expired upstream fallback URLs trigger a bounded metadata refresh.
Provider auth/expiry/transport failures show a safe error; closing/reopening the player requests
fresh detail. API-token refresh is managed by the owner-scoped FirebaseSession runtime; refresh-token rotation
is persisted to the encrypted store before the new token is cached. Disconnect/reconnect fences
reject late media responses and credential writes.

## Production dependency and validation

The OWNER enters their own Firebase API key and refresh token at `/settings#transformmate` over
HTTPS. The form clears secrets after submission, exposes only safe verified profile/status data,
and offers check/reconnect and a confirmed local disconnect. TRAINER cannot manage credentials.
See [encrypted connection and account binding](transformmate-secure-connection.md) for storage,
rotation, tombstones and owner authorization. No agent reads or transfers the user's credentials.

Compose configures only `TRANSFORMMATE_TOKEN_FILE=/app/data/transformmate-token.json` in the
existing database volume. The application has no environment-credential fallback. Before the
OWNER connects, catalog/sync report unavailable and manual/local saving continues to work. The
standalone research CLI still uses its explicitly separate probe environment settings. Preserve
the encrypted file, tombstone, existing auth secret/owner ID, DB and uploads together when backing
up/restoring. No additional key, volume, scheduler or network is introduced. Deployment stays in
the main coordinator's single rollout queue. Synthetic tests do not establish live provider sync;
a genuinely intended user's workout is the live acceptance scenario after their own connection.

The lean suite keeps one migrated SQLite integration scenario for the highest-cost failure: a
committed TransformMate create whose response is lost must recover after restart without a second
POST. Owner/trainer boundary protection is covered by the common authorization integration check;
normal workout creation is covered by the application smoke path. The synthetic client is local to
the test and never contacts a provider or real credentials.

Run the focused diagnostic when changing this recovery path:

```sh
pnpm exec vitest run tests/integration/transformmate-sync.test.ts
```

No real training is created, edited or deleted for testing. The wire contract remains documented in
[write API](transformmate-write.md) and [exercise API](transformmate-exercises.md).
