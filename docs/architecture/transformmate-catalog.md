# Persistent private TransformMate catalog

The home-server SQLite database stores catalog summaries, a real muscle dictionary,
exercise details. Devices and application restarts share this backend copy.
[Persistent replica](transformmate-replica.md) describes the durable queue, S3 media,
generated posters, monthly jitter and disconnected access.

All rows are scoped by owner, accountScope, stable account identity and
locale (`ru`). Every request checks `workouts:read` for its owner and the active
connection before reading, before committing upstream results and before responding.
Disconnect stops updates while preserving local reads. A different account remains
isolated. Token refresh does not invalidate catalog reads. SQLite writes are short
transactions; HTTP never runs inside them.

The catalog response has one v1 format:
`{ contractVersion: 1, source: 'user', data: CatalogItem[], catalog: Metadata }`.
Dictionary and detail responses retain typed objects in `data`. Producers always
include rich fields and metadata; no legacy format or fallback exists.

Catalog coverage distinguishes a complete short list from incomplete membership
or alias enrichment. Filtering and paging run locally. Missing details remain unknown,
not evidence that an exercise has no matching muscles or alias. Read-only requests
return stored details even when stale; the persistent worker owns monthly refresh.
Visible IDs only raise queue priority and do not launch a batch of HTTP requests.

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
permissions/binding fences remain enforced. Stored S3 video and generated posters
are preferred; upstream streaming is a bounded reserve.

Tests use synthetic fixtures and disposable databases. Fresh and pre-catalog
migration paths, restart persistence, isolated scopes, owner cascade, query bounds,
partial coverage, enrichment coalescing, metric diagnostics, media security and
revocation are covered. No test copies production databases or provider credentials.
