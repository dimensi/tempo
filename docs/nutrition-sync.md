# Nutrition sync server API v1

Frozen consumer entry: `@/server/nutrition`. All methods authorize supplied request headers and owner ID; missing or denied scope throws `NutritionAccessError` with status 401/403. Dates are ISO calendar dates, decimal strings and unknown/known/official/delta/issues follow `@/contracts/nutrition` unchanged.

```ts
getNutritionDay(headers: Headers, ownerId: string, date: string): Promise<NutritionDay | null>
listNutritionDays(headers: Headers, ownerId: string, period: {from: string; to: string}): Promise<NutritionDay[]>
nutritionDayExists(headers: Headers, ownerId: string, date: string): Promise<boolean>
getPhotos(headers: Headers, ownerId: string, date: string): Promise<SafeMealPhotoView[]>
listMealPhotos(headers: Headers, ownerId: string, period: {from: string; to: string}): Promise<SafeMealPhotoView[]>
readMealPhoto(headers: Headers, ownerId: string, photoId: string): Promise<{bytes: Buffer; contentType: string}>
```

Photos return only id/date/daytime/source/observedAt. Bytes are fetched from `/api/nutrition/photos/{id}?ownerId=…`; never expose source URL or storage key. One current YAZIO photo per owner/date/daytime; manual photos are independent and survive sync. Manual mutations require OWNER nutrition:write. Every mutation checks same origin before reading its body.

## Owner connection

The owner connects with email and password. POST `/api/yazio/connect` accepts `{email,password,timezone,initialFrom}`, stores the encrypted connection and runs the initial history import. Passwords stay in request memory. POST `/api/yazio/disconnect` requires `{confirmed:true}` and preserves saved nutrition and photos. Both operations check origin and owner scope before accessing credentials or data.

`configuredStore(ownerId)` requires an operator-configured `YAZIO_TOKEN_FILE` outside public/uploads and the existing `BETTER_AUTH_SECRET` (32+ characters). Suggested production path remains `/app/data/yazio-token.json`, but this code does not activate it or change any runtime settings. Parent/operator approval is required for that configuration step and the user supplies their own credentials after deployment.

Files contain a strict version-1 AES-256-GCM envelope (generation, 12-byte nonce, 16-byte tag, ciphertext), never plaintext token JSON. HKDF-SHA256 derives a per-owner key from the existing auth secret using a versioned domain context. Authenticated data binds context/version/owner/generation. Atomic writes use 0600 files and 0700 newly created directories. Disconnect rotates generation and writes authenticated encrypted null. A loaded store checks its generation on saves/current-session checks; stale refresh or delayed connection cannot resurrect a disconnected/replaced connection. Writes are serialized per file within the supported single process. Concurrent SDK authentication on one client shares one in-flight refresh; its callback failures are handled and persistence is awaited before downstream reads.

No legacy plaintext fallback: existing plaintext stores need an explicitly approved operator migration/reconnection, not an automatic conversion. Backups must restore the encrypted connection file together with the same `BETTER_AUTH_SECRET` and owner identity. SQLite backup alone does not include this file. Secret rotation or changed owner identity requires explicit migration or disconnect/reconnect; decryption failures never fall back to plaintext. No new persistent key is created.

Tests use real Better Auth sessions and a test-only OAuth wire stub injected into a disposable child process. The actual vendored SDK still performs exchange/refresh; production has no test endpoint or hook. The UI regression runs in `pnpm test` (Chromium is installed before unit tests in CI).

Owned paths: server/nutrition, server/yazio, server/jobs, schema/nutrition and nutrition-photos, contracts/nutrition-sync, assigned nutrition/yazio routes, settings/yazio, tests/nutrition-sync and this document. Frozen base `fa1f261`. No generated migration, shared/core/dependency edits, credentials creation, merge or deployment.

Schema freeze: `nutritionDays`, `nutritionCache`, `nutritionSyncRuns` from `src/server/db/schema/nutrition.ts`; `nutritionPhotos` from `src/server/db/schema/nutrition-photos.ts`. Coordinator must export these in schema.ts before generating the central migration. Tests use explicit disposable in-memory DDL until that migration exists. Existing SDK 1.2.0 is missing meal images: full sync fails closed until B's consuming dependency patch is accepted. No private research data is copied.

Run owned tests: `pnpm exec vitest run --config tests/nutrition-sync/vitest.config.ts`. Coordinator must include this suite in central CI (the foundation runner includes only tests/unit and tests/integration).

History imports cover 1–366 inclusive days. The seven-day refresh rereads at most seven inclusive dates. Product and recipe lookups are deduplicated and bounded at four. Photo downloads are bounded at two. Food and photos are persisted separately. A validated empty day can replace upstream food entries. Valid photo metadata can remove upstream photo slots. Failed reads preserve the previous valid data for that portion. Manual photos survive every import.

Image downloads accept only HTTPS images.yazio-cdn.com:443 with no credentials, resolve public DNS and pin the checked address, reject redirects, allow JPEG/PNG/WebP with matching magic bytes, limit bytes to 8 MiB and requests to 15 seconds. Files are content-addressed and private (0700 directory, 0600 immutable file); no upstream bearer reaches CDN. Metadata includes hash and observation time. Unreferenced content-addressed files are retained after deletion/failed sync: physical garbage collection is a separate operator concern. SDK calls have a 30-second bounded wait; the SDK does not expose transport cancellation. See the scheduler guide for retries and server refresh. One supported Next.js process prevents overlapping owner syncs; after process interruption, the next sync replaces the last running status.

POST `/api/yazio/sync` accepts `{mode:"history",from,timezone}` or `{mode:"recent",timezone}`. GET `/api/yazio/sync` is an owner-only read of the active stages, pending photo dates and latest outcome. Token values and file paths are absent from responses.

Readers: GET `/api/nutrition/days?ownerId&from&to`, `/api/nutrition/days/{date}?ownerId`, `/api/nutrition/photos?ownerId&from&to`. Manual upload: POST `/api/nutrition/photos?ownerId&date&daytime` with raw image bytes and image Content-Type; delete: DELETE `/api/nutrition/photos/{id}?ownerId`. Every public server method separately authorizes owner scope. Read-only trainer grants are checked on every call and immediately respect revocation.

## Diary loading flow and calendar ranges

The form has one history date, defaulting to six days before today when no start was saved. History loads from that date through today. The seven-day refresh uses the saved start and timezone and leaves the history start and automatic attempt timestamp intact. Date validation uses calendar days in the selected timezone.

Tests cover timezone boundaries, DST/leap days, invalid/future ranges before SDK calls, delayed-JS hydration, selected start through today, connect plus load, and truthful successful connection with failed sync/retry. All account traffic remains synthetic in tests with real app authentication.

## Hourly schedule integration

See [nutrition scheduler](nutrition-scheduler.md) for leases, fencing, restart recovery and bounded retry policy. Connect require validated `timezone` and `initialFrom` metadata, validate them before credential exchange or storage access, then enable the owner schedule only after awaited token save. The same handler immediately starts the initial selected-history backfill; no second browser sync request is required. Obsolete connection payloads are rejected; current inputs carry the selected date and browser timezone. Confirmed disconnect revalidates permission, disables the schedule and invalidates its epoch before awaiting token removal. Status reads remain read-only. Manual sync calls the same durable lease service as the automatic job; routes never prepare an upstream client before lease acquisition.

The owner form restores the persisted start and shows whether the server schedule is enabled. Closing the browser does not cancel server work. Hourly runs cover today and yesterday, bounded by the history start.

`ENABLE_NUTRITION_SCHEDULER` defaults to false. Activate it only after this complete hooks/UI integration and exact-head checks. The separately approved encrypted path `/app/data/yazio-token.json` is already configured in preview; this configuration does not establish whether the human has since supplied a real token. OWNER already exists, and bootstrap is only for a new empty stack. Live account acceptance belongs to the user; test traffic remains synthetic.

## Account card and initial server backfill

Connect intent is the button itself with a short encrypted-storage description; there is no app consent checkbox. The obsolete `confirmed` field is rejected for connect. Disconnect retains its explicit confirmation. Successful token persistence is reported separately from failed/partial initial loading. The server awaits the same common leased job from the connect handler, ignoring browser cancellation; closing the tab after job initiation does not create a client-request gap. A process restart still follows the scheduler's documented recovery model, not an invented persistent history queue.

The confirmed SDK `getUser(token)` calls `/user`. Only bounded email/name and a safe supported CDN avatar URL are projected into the authorized owner card; raw profile fields such as user_token never return or persist. Metadata is process-memory only and cleared on disconnect. Passwords/tokens are never account-card metadata. If profile lookup fails, the submitted YAZIO email (when known) or neutral YAZIO identity is used; the app OWNER identity is never substituted. Restart may show the neutral card until a successful manual update performs the optional SDK profile read using the already authenticated token; no credential re-entry or out-of-lease refresh occurs. Status remains a read-only local lookup and never invokes upstream. The connected card hides login fields and exposes disconnect visibly.

`YazioSettingsForm` supports `embedded` and stable `#connection`/`#sync` section anchors with h2 headings in one mounted component. Hash navigation does not reset selected dates or errors.

## Separate food and photo outcomes

SyncStatus requires `photoFailedDates` alongside `completedDates` (persisted valid food) and `failedDates` (food/metadata/reference failures). There is no missing-field/default compatibility path; a reviewed data migration preserves stored statuses. A photo-only failure makes the overall state partial, but the UI reports food loaded plus a photo warning, not a connection failure. Food failures remain separate. The optional account lookup is permitted after valid food completion even if photo downloads remain incomplete. Core records PHOTO_INCOMPLETE and bounded media retries separately from genuine food success.
