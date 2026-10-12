# Persistent private TransformMate catalog

The home-server SQLite database stores catalog summaries, a real muscle dictionary,
opened/visible exercise details and canonical query pages. Devices and application
restarts share this backend cache. It does not store videos or create offline media.

All rows are scoped by owner, accountScope, persisted connectionId generation and
locale (`ru`). Every request checks `workouts:read` for its owner and the active
connection before reading, before committing upstream results and before responding.
Disconnected/replaced generations remain inaccessible. Token refresh retains the
same connection identity. SQLite writes are short transactions; HTTP never runs
inside them. The new migration adds only three cache tables and scoped indexes.

The catalog response has one v1 format:
`{ contractVersion: 1, source: 'user', data: CatalogItem[], catalog: Metadata }`.
Dictionary and detail responses retain typed objects in `data`. Producers always
include rich fields and metadata; no legacy format or fallback exists.

Catalog metadata `complete` means a successful full-list snapshot for an unfiltered
request, or a verified canonical SDK query page for a filtered request. It does not
mean every description, preview or membership is enriched. `partial` denotes local
matches without an authoritative query snapshot. `unknown` denotes cold/failed
coverage, including an empty result that cannot prove there are no matching exercises.
`total` is null when not established. `unknownMembershipCount` counts returned
page rows without detail for verified snapshots, or unknown cached candidates
before filtering for a local fallback; it does not assert unknown rows fail filters. `refreshState` distinguishes idle, updating
and unavailable. Fetched timestamps and `stale` remain visible during outages.

Subgroup selections use exact localized dictionary names and form a union. One
common group intersects those subgroups. IDs are never guessed into filter names.
Search text is trimmed/lowercased; subgroup names are deduplicated and sorted for
canonical page keys. Cached aliases come only from fetched details. Unknown membership
is never treated as confirmed absence. Filtered pages cannot complete or replace
the unfiltered catalog; successful full refresh replaces only that membership set.

Freshness is five minutes. Known stale records return while a coalesced refresh runs;
cold requests wait for their bounded SDK request and report unknown/unavailable on
failure. At most 64 query snapshots persist per scope. Failed-operation bookkeeping
is bounded to 256 entries and 429 cooldowns to 32 scopes. Detail enrichment accepts
at most six explicitly visible IDs already on the returned page (`visible` repeated
query parameters), with two upstream detail requests globally and a queue bound of 64. Opened details have priority over queued visible items. UI should request visible
enrichment once after rendering a page, not for each typed character. Repeated/opened
IDs coalesce; warm details avoid repeated HTTP. These are application budgets, not
claims about provider limits. Old-generation rows are not automatically deleted.

Detail persistence is a bounded validated projection: name, description, aliases,
actual muscles/groups/positions, publication metric metadata, real image URL and
selected media metadata. Unknown passthrough fields and unrelated links are dropped.
URLs stay server-only. Public capability diagnostics mirror the existing strict
shared publication gate: precisely two metrics, weight(id 3) and reps(id 4).
Missing detail is `unknown`; an unsupported reason names the failed metric condition.
The same pure helper drives summary readiness, detail diagnostics and `canProject`.
Advanced type metadata does not prohibit scalar straight values: the coordinator
verified exercise 6 detail advertises only `two_in_one`/`drop`, while successful
native/probe readbacks retain straight weight/reps for that exercise. These observed
readbacks falsify the old explicit-straight allowlist guard; they do not establish
support for publishing advanced types. Scalar string projection, null-weight
omission, fresh detail/ID validation, authorization/binding/revision, attempt and
fact/start/conflict guards remain unchanged. Existing unsupported state is not
migrated or automatically retried; no publication is initiated by catalog refresh.

Real previews initially remain unknown; null images are absent. An authenticated
GET `/api/workouts/transformmate/exercises/{id}/preview?ownerId={encodedOwner}`
validates HTTPS exact `transformmate.pht.space`, no port/userinfo/hash, no redirects,
no JWT/cookie forwarding, JPEG/PNG/WebP/AVIF MIME and signature, a five MiB limit and
one ten-second abort deadline. Successful validation records availability. A failed
request retains unknown coverage; compare-before-write protects newer detail data.
The UI may attempt this relative route for an enriched item whose preview is unknown;
no poster or image source is invented. Responses are private/no-store/nosniff.

Video GET/HEAD reuse persisted metadata and refresh unavailable/expired URLs at most
once per request. HTTPS exact `kinescopecdn.net`, no port/userinfo/hash, no redirects
or credential forwarding, single Range validation, response MIME/range checks and
permissions/connection fences remain enforced. Video mirroring is deferred.

Tests use synthetic fixtures and disposable databases. Fresh and pre-catalog
migration paths, restart persistence, isolated scopes, owner cascade, query bounds,
partial coverage, enrichment coalescing, metric diagnostics, media security and
revocation are covered. No test copies production databases or provider credentials.
