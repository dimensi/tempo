# TransformMate workout integration

**Acceptance gap:** automatic publication currently covers first creation only. Editing an already
published, even unstarted and otherwise unchanged remote workout stays local with a conflict.
This is not complete save-to-sync behavior or full bidirectional sync. A guarded update requires
verified upstream atomic conditional-write support; GET/compare/PATCH alone cannot close the race.
The minimal proof uses a separately authorized disposable training: stale writes must reject after
an external edit/start, and planned/actual data must remain unchanged on rejection. Only after that
proof can the baseline, fresh ownership/idle/fact checks, atomic precondition and post-write
verification be connected to save. No such real write probe is authorized overnight.

The workout editor keeps manual plans and sessions and adds catalog exercises with a local
occurrence UUID and optional exercise comment. Dates, array order, repetitions and nullable kg
remain explicit. Every linked exercise must support the verified weight/reps straight metrics.
Mixed manual/catalog workouts remain local with a visible unsupported status; there is no partial
publication. The save button persists the local plan and automatically publishes eligible new
workouts, without a separate confirmation. Copying a plan shifts calendar dates, generates new
workout/occurrence IDs and copies planned sets/comments only. Recurring plans and uploaded videos
are outside this change.

## Persistence and recovery

Migration `0005_ambitious_whirlwind` adds only `workout_transformmate_links`. Owner FK and scoped
unique indexes enforce one link per owner/plan/workout and one remote ID per owner. Local plan
deletion keeps links, immutable original plan snapshots and imported actual results. Deleting the
owner removes their records. Orphan history still requires the current owner or trainer grant.

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
an already attempted record only verifies. Ownership/grants are checked around network operations.

The supported runtime remains one Next.js process with SQLite WAL. In-process owner serialization
and persisted CAS prevent competing local requests from claiming the same intent. No network
request runs in a database transaction.

## Remote edits and actual results

The verified upstream write API sends a full training DTO and has no confirmed atomic compare and
swap precondition. Consequently this integration **never PATCHes or DELETEs an existing remote
training**. Editing the local plan saves it locally and shows a conflict when the published plan
differs. Starting/completing a training or external changes are read without overwriting them.
The UI explains this limit and offers copying to new dates for a new publication.

Actual sets come exclusively from current `metrics[type=fact]`, with explicit order, done flag,
metric type and original string values. Historical `best_result`/`last_results` are not actuals.
Fact IDs are never treated as stable identity. Initial correspondence uses the complete ordered
semantic projection; when that projection changes, ambiguous occurrence keys become null. The
UI additionally checks catalog exercise ID and local occurrence key before placing a result beside
a planned set. Unknown/range/empty values are retained without invented numeric results. Manual
sessions and their original snapshots are unchanged.

`GET /api/workouts/transformmate?ownerId=…` reads the scoped local status/results. Same-origin POST
refreshes provider results and verifies ambiguous attempts; eligible never-attempted intents can
publish under current plan permission. The visible dashboard refreshes on load, focus and every
60 seconds; there is no recurring workout creation or new background scheduler.

## Catalog and video

Owner/granted trainer routes return safe catalog and detail DTOs. Search returns at most 50 items.
The server checks detailed straight-metric capability before publication. Provider responses and
media URLs never reach the browser. Read-only verification found 1 098 catalog items and direct
MP4 variants at the exact HTTPS host `kinescopecdn.net`. Anonymous HEAD returned 200 video/mp4
with byte ranges; GET `bytes=0-1023` returned 206 and the expected Content-Range. This verifies
media transport, not a real account write or physical-phone playback.

Video.js 8.24.1 is pinned. Opening the description does not fetch media; showing the player still
uses `preload: none` and no autoplay. Play, seeking, speed and fullscreen work in synthetic browser
tests. Scoped controls have 44 px targets, and speed stays available at mobile widths. Selection
changes/unmount dispose the player. Chromium mobile emulation is not a physical iPhone check.

The private same-origin video route checks current access, obtains fresh exercise detail for every
HEAD/GET/seek request, allows only the exact CDN host and MP4 format, forwards one validated Range,
and streams rather than buffering the entire video. It rejects redirects, cancels on client abort
or revoked authorization before response, validates 206/416 headers, and sends private no-store.
No Firebase/JWT credentials, provider cookies, signed URLs or upstream errors are forwarded/logged.
Only the requested video is streamed; catalog video downloading does not occur.

Observed links have `expires`/`sign` query fields. Their duration is provider-controlled and is not
assumed stable or hardcoded. Fresh detail on each media request avoids reusing an expired URL.
Provider auth/expiry/transport failures show a safe error; closing/reopening the player requests
fresh detail. API-token refresh is managed by the existing FirebaseSession singleton; refreshed
credentials stay in process memory, without a new persistent credential store.

## Production dependency and validation

Compose passes the two existing server-only variables `TRANSFORMMATE_FIREBASE_API_KEY` and
`TRANSFORMMATE_FIREBASE_REFRESH_TOKEN`, defaulting to empty. They are never NEXT_PUBLIC variables.
When missing, manual functionality and local plan saving work and sync reports unavailable.
The production read-only configuration check found both variables absent. No credential transfer
or installation was performed. Activation requires a separate approved secure operator handoff to
`/opt/compose/yazio-dashboard/runtime.env`; retain its private permissions and existing stack,
volumes, YAZIO credentials/scheduler and server-local routing. Deployment stays in the main
coordinator's single rollout queue. Mock tests do not establish live synchronization.

### User-only credential setup

The owner performs this later; the agent does not read, copy or send the values on their behalf.
Open a trusted SSH terminal on `home-server`, enter `/opt/compose/yazio-dashboard`, set `umask 077`
and edit `runtime.env` with a terminal editor. Add the existing values under the exact names
`TRANSFORMMATE_FIREBASE_API_KEY` and `TRANSFORMMATE_FIREBASE_REFRESH_TOKEN`. Keep all existing
configuration, especially Better Auth/YAZIO, intact. Do not paste credentials into chat, shell
commands/history, logs, commits or screenshots. After saving, run `chmod 600 runtime.env`, close
the editor and report only that configuration is ready. The main coordinator then controls the
reviewed release's single rollout; the owner checks a genuinely intended new workout through UI.
This step does not resolve the published-edit acceptance gap and does not authorize extra real
write/delete probes.

Dedicated tests use real Better Auth cookies, owner/trainer grants and a migrated disposable local
SQLite database. A strictly test-only preload intercepts fixed provider hosts to a loopback
synthetic upstream and rejects production or real connection values. It is never activated in
the app or Docker runtime. Tests cover automatic create, idempotency, committed/uncommitted lost
responses, external/started conflicts, ID changes, separate facts, orphan history, manual records,
revocation, private Range and real synthetic MP4 playback/seek/speed/fullscreen on desktop/mobile.
File-backed restart and transaction-abort tests prove durable recovery and all-or-nothing local
plan/intent persistence. Fresh and existing migrations preserve prior workout JSON/history.

Run standard checks and, sequentially after other E2E resets:

```sh
pnpm test:e2e --config tests/transformmate-sync/e2e.config.ts
```

This suite refuses local `.env` files and owns only `.data/e2e.sqlite`. No real training is created,
edited or deleted for testing. The wire contract remains documented in
[write API](transformmate-write.md) and [exercise API](transformmate-exercises.md).
