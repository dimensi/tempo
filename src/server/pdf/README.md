# Report integration and runtime handoff

Owned implementation: `src/server/pdf`, reports UI/routes, v1 report request and report tests. No DB migrations, shared auth or Docker changes in this branch.

Reports use authoritative `NutritionDay.totals`; the only derived metric is an exact decimal period sum. Missing dates and null nutrients remain unknown with separately labelled known totals. An empty dataset is 404, never an invented zero day. HTML/PDF share escaped markup and a local embedded Cyrillic font. No Chromium navigation to an internal endpoint: `page.setContent`, fresh context, no cookies, JavaScript disabled, all network blocked, data images/fonts only. Response is private/no-store with CSP and sandbox. Every request uses `reports:export` and owner scope, repeated before releasing output.

## Source C integration

`reportDataSource(headers)` statically imports source C and composes its authorized public interface through `createNutritionReportSource`. There is no demo fallback or global test setter. The adapter preserves the agreed DTO without conversion or nutrient recalculation:

```ts
import * as nutrition from '@/server/nutrition';

export function reportDataSource(headers: Headers): ReportDataSource {
  return createNutritionReportSource(headers, nutrition);
}
```

The handler passes request headers to the adapter; Chromium never receives them. The reports page uses `getAccessibleOwnerId(await headers())` from `@/server/access/owner`. No trainer owner-ID input is exposed; a missing grant disables export controls. The helper does not replace the route guard.

Source C must bound source reads before materializing days/photos; this service bounds the received dataset and each private image. Agreed source C methods do not accept AbortSignal; cancellation is checked before/after each read. There is no upstream request from the reports path.

## Required coordinated package / Docker patch

The foundation intentionally excludes Chromium. For runtime PDF the coordinator must make this separate core change, regenerate lockfile and verify Docker smoke:

```diff
--- a/package.json
+++ b/package.json
@@ devDependencies
-    "@playwright/test": "^1.64.0",
@@ dependencies
+    "@playwright/test": "^1.64.0",
--- a/next.config.ts
+++ b/next.config.ts
@@
-  serverExternalPackages: ['better-sqlite3'],
+  serverExternalPackages: ['better-sqlite3', '@playwright/test', 'playwright', 'playwright-core'],
--- a/Dockerfile
+++ b/Dockerfile
@@ runtime
-ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_URL=file:/app/data/nutrition.sqlite UPLOADS_DIR=/app/uploads
+ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_URL=file:/app/data/nutrition.sqlite UPLOADS_DIR=/app/uploads PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PDF_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
@@ before USER node, after standalone COPY
+RUN node node_modules/playwright-core/cli.js install --with-deps chromium \
+    && apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core \
+    && rm -rf /var/lib/apt/lists/* \
+    && chown -R node:node /ms-playwright
```

Chromium must match the locked Playwright revision, not apt Chromium. The server checks `PDF_FONT_PATH`, default macOS Arial / Linux DejaVu Sans, max 2 MiB. Font bytes are embedded per request. If browser/font is unavailable PDF returns a sanitized 503; HTML still requires the font. No public report files or persistent browser process. Do not ship `/System/Library` fonts in Linux images.

CI currently runs Vitest before installing Chromium. Install the locked Chromium before `pnpm test` and include Poppler (`poppler-utils` on Debian; `poppler` on Homebrew), because the report integration test generates PDFs and inspects extracted Cyrillic, embedding, A4 geometry, image dimensions, every page's nonblank content and text clipping. This is an additional coordinated CI change. No silent skip for missing runtime/tools.

## Limits and verification

Max 31 days, 3000 entries, 60 raster photos, 8 MiB each (aligned with source C) / 20 MiB total, 16 million pixels each / 32 million total, 8 MiB source JSON, 40 MiB HTML. One full report request at a time in the supported single Next process, no unbounded queue. Browser launch max 15s, rendering max 25s with finally-close; data abort after 45s checked between source reads. Source strings max 1500 characters, summed decimals max 80 characters and exponent magnitude 100. No DB transaction spans rendering.

`tests/integration/pdf-rendering.test.ts` runs a genuine generator on synthetic days and a synthetic 2:1 raster photo for daily/weekly/custom periods. Optional `PDF_VERIFICATION_DIR` (existing directory) saves a PDF and raster screenshots for manual review. No personal data is used. `pdf-authorization.test.ts` exercises actual SQLite grants with a session fixture, including mid-generation revocation; E2E uses real Better Auth and no mocked security session.

`tests/e2e/reports-persisted.spec.ts` uses the disposable E2E DB for a synthetic persisted snapshot, uploads a synthetic 2:1 PNG through the authorized nutrition API, previews HTML and downloads a real PDF through the UI. It extracts Cyrillic and photo metadata from those actual downloaded bytes, then checks a real trainer session without grant, with grant, and after revocation. The real rendering integration test also exercises a valid PNG larger than 3 MiB.

Remaining gates: coordinated runtime/CI patch, bounded source C snapshot reads before JSON parsing, and execution of the new persisted-data E2E on an environment that permits Chromium and Next.js IPC. Current local sandbox denies Chromium MachPortRendezvous and tsx IPC; these checks are not claimed passed after wiring.
