# Local-first private workspace

[ADR 002](../decisions/002-local-first-private-workspace.md) defines the access and UI invariants.

## One interface

`PrivateReadWorkspace` owns the mounted route views and their session scroll state. The ordinary dashboard and the public, cached boot document import this same composition. Connection changes never select another renderer. Native History changes managed read routes immediately; network-only editor routes use the Next router. Modified clicks, downloads, external links and same-page anchors retain browser behavior.

The layout authenticates its initial request and may supply an authorized read context. Every data endpoint independently reauthorizes the owner scope. Route files provide metadata; the workspace renders diary, workouts/details/catalog, measurements, overview, analytics, reports, settings and medical views through their ordinary feature modules. Previously visited route instances remain in React Activity for Back/Forward; access denial and logout discard private route state. Provider mutations conceal the current view while retaining its form until the same reader is reauthorized.

## Read interface

`useReadResource({ href, parse }, initialSeed?)` returns `data`, `coverage`, `refreshing`, `error`, and `refresh()`. A mounted descriptor has one parser contract; changing its URL keeps the same DTO type. Features do not choose between disk and server.

The common read module handles canonical keys, memory, fenced IndexedDB persistence, validation, concurrent requests and background revalidation. App snapshot adapters seed normal DTOs without presenting bounded coverage as a complete collection. Network responses and initial seeds cannot cross a changed partition, device epoch or connection generation. Equal subtrees retain their identity; forms maintain their own drafts independently.

The private `/api/read/context`, `/api/read/workout`, `/api/read/analytics` and owner-only `/api/read/settings` endpoints expose existing authorized presentation data. Their explicit Zod whitelist is the only new persistence surface. Credentials and external avatar URLs never enter disk records. Workout detail records obey the existing rolling retention window; analytic summaries retain their separate coverage. Read records use version 2 with explicit complete/partial coverage; incompatible older response records are discarded and refilled through the ordinary authorized reads. No SQL schema or business calculation changes are involved.

Ordinary workout and settings response records are prepared in a bounded background queue from covered snapshot routes. The existing ordered owner write queue remains independent. Reports retain their existing local HTML renderer, supplied by an app read adapter; this is feature-specific cleanup deferred from this change.

## Access lifecycle

Local storage validation and bounded identity refresh start independently. A valid local copy can publish while identity is stalled; an already observed denial blocks publication before physical cleanup. Local reads are coalesced so a superseded operation cannot publish after a newer denial.

All private content, including enlarged photo portals, participates in synchronous conceal. BFCache pagehide conceals before the document freezes; pageshow cannot reveal while the new local check is pending. Routine same-scope checking keeps the mounted UI visible.

Logout records durable intent and conceals synchronously, purges read data and the device write queue, and then attempts server sign-out. Offline failure leaves the intent blocking local activation across reloads. Reconnect or the next login completes server sign-out before allowing another login. Real denial, account changes and trainer revocation use the same conceal/purge fences. Blocked scopes stop background reads until a verified bundle returns; progress within a scope does not restart transports. Worker purge notifications carry their originating device epoch, so a late cleanup cannot conceal a newer verified scope. Network timeouts and 5xx responses never masquerade as authorization failure.

## Verification

Verification tier: Full. Unit/integration tests cover stalled reads, partial coverage, structural sharing, stale-scope responses, durable logout, real-session endpoint authorization and storage fences. Production browser tests cover ordinary/cold entry, desktop/mobile navigation, retained drafts, local writes, cross-tab conceal, photo portals and worker updates. Before delivery, run `pnpm verify:merge` on a clean committed revision and the complete production offline suite on the same SHA. No merge or deploy is implied.
