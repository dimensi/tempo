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

Owned paths: server/nutrition, server/yazio, server/jobs, schema/nutrition and nutrition-photos, contracts/nutrition-sync, assigned nutrition/yazio routes, settings/yazio, tests/nutrition-sync and this document. Frozen base `fa1f261`. No generated migration, shared/core/dependency edits, credentials creation, merge or deployment.

Schema freeze: `nutritionDays`, `nutritionCache`, `nutritionSyncRuns` from `src/server/db/schema/nutrition.ts`; `nutritionPhotos` from `src/server/db/schema/nutrition-photos.ts`. Coordinator must export these in schema.ts before generating the central migration. Tests use explicit disposable in-memory DDL until that migration exists. Existing SDK 1.2.0 is missing meal images: full sync fails closed until B's consuming dependency patch is accepted. No private research data is copied.

Run owned tests: `pnpm exec vitest run --config tests/nutrition-sync/vitest.config.ts`. Coordinator must include this suite in central CI (the foundation runner includes only tests/unit and tests/integration).

Period: inclusive 1–366 days; recent: 1–31 days ending at explicit calendar date. Days run serially, product/recipe lookups deduplicated and bounded at four, photo download/store bounded at two. Cache is owner-scoped and expires after 24 hours. Confirmed null references retain domain unknown/issues; thrown reference errors fail the whole day. Complete nutrition and current YAZIO photos replace atomically; failed reads/downloads/normalization preserve previous day and photos. A successful empty day deletes previous upstream entries/photos. Manual photos are never replaced by sync.

Image downloads accept only HTTPS images.yazio-cdn.com:443 with no credentials, resolve public DNS and pin the checked address, reject redirects, allow JPEG/PNG/WebP with matching magic bytes, limit bytes to 8 MiB and requests to 15 seconds. Files are content-addressed and private (0700 directory, 0600 immutable file); no upstream bearer reaches CDN. Metadata includes hash and observation time. Unreferenced content-addressed files are retained after deletion/failed sync: physical garbage collection is a separate operator concern. SDK calls have a 30-second bounded wait; the SDK does not expose transport cancellation. No retries or scheduler are enabled. One supported Next.js process prevents overlapping owner syncs; after process interruption, the next sync replaces the last running status.

Mutations: POST `/api/yazio/token` with existing Token JSON; POST `/api/yazio/sync` with `{mode:'period',from,to}` or `{mode:'recent',days,through}`. Token file must be operator-configured outside public/uploads; no token creation/login API or live setup is run. Token values and file paths never appear in responses. Settings are available at `/settings/yazio`.

Readers: GET `/api/nutrition/days?ownerId&from&to`, `/api/nutrition/days/{date}?ownerId`, `/api/nutrition/photos?ownerId&from&to`. Manual upload: POST `/api/nutrition/photos?ownerId&date&daytime` with raw image bytes and image Content-Type; delete: DELETE `/api/nutrition/photos/{id}?ownerId`. Every public server method separately authorizes owner scope. Read-only trainer grants are checked on every call and immediately respect revocation.
