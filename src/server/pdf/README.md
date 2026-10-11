# Report integration and runtime handoff

Owned implementation: `src/server/pdf`, reports UI/routes, v1 report request and report tests. No DB migrations, shared auth or Docker changes in this branch.

Reports use authoritative `NutritionDay.totals`; the only derived metric is an exact decimal period sum. Missing dates and null nutrients remain unknown with separately labelled known totals. An empty dataset is 404, never an invented zero day. HTML/PDF share escaped markup and a local embedded Cyrillic font. No Chromium navigation to an internal endpoint: `page.setContent`, fresh context, no cookies, JavaScript disabled, all network blocked, data images/fonts only. Response is private/no-store with CSP and sandbox. Every request uses `reports:export` and owner scope, repeated before releasing output.

Numerical text uses the shared `formatDecimal` presentation helper: ordinary values have at most two decimal places, very small/large values have bounded text, and nonzero deltas below display precision show `≈ 0`. Null remains unknown; source decimals and exact period calculations are unchanged. The form initializes its start date once from the browser's local calendar after hydration, preserving edits and explicit clearing across period changes.

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

## Runtime requirements

The coordinated runtime changes are integrated: Playwright is a production dependency and an external server package; the Docker image installs its locked Chromium revision and a Cyrillic font. Chromium must match the locked Playwright revision, not apt Chromium. The server checks `PDF_FONT_PATH`, default macOS Arial / Linux DejaVu Sans, max 2 MiB. Font bytes are embedded per request. If browser/font is unavailable PDF returns a sanitized 503; HTML still requires the font. No public report files or persistent browser process. Do not ship `/System/Library` fonts in Linux images.

CI installs the locked Chromium before Vitest and includes Poppler (`poppler-utils` on Debian; `poppler` on Homebrew), because the report integration test generates PDFs and inspects extracted Cyrillic, embedding, A4 geometry, image dimensions, every pages nonblank content and text clipping. No silent skip for missing runtime/tools.

## Limits and verification

Max 31 days, 3000 entries, 60 raster photos, 8 MiB each (aligned with source C) / 20 MiB total, 16 million pixels each / 32 million total, 8 MiB source JSON, 40 MiB HTML. One full report request at a time in the supported single Next process, no unbounded queue. Browser launch max 15s, rendering max 25s with finally-close; data abort after 45s checked between source reads. Source strings max 1500 characters, summed decimals max 80 characters and exponent magnitude 100. No DB transaction spans rendering.

`tests/integration/pdf-rendering.test.ts` runs a genuine generator on synthetic days and a synthetic 2:1 raster photo for daily/weekly/custom periods. Optional `PDF_VERIFICATION_DIR` (existing directory) saves a PDF and raster screenshots for manual review. No personal data is used. `pdf-authorization.test.ts` exercises actual SQLite grants with a session fixture, including mid-generation revocation; E2E uses real Better Auth and no mocked security session.

`tests/e2e/reports-persisted.spec.ts` uses the disposable E2E DB for a synthetic persisted snapshot, uploads a synthetic 2:1 PNG through the authorized nutrition API, previews HTML and downloads a real PDF through the UI. It extracts Cyrillic and photo metadata from those actual downloaded bytes, then checks a real trainer session without grant, with grant, and after revocation. The real rendering integration test also exercises a valid PNG larger than 3 MiB.

The report form keeps controls disabled until hydration, so cold navigation cannot discard dates entered before React attaches event handlers. The persisted E2E deliberately holds client scripts to verify this, then exercises the same preview and PDF assertions after release.

Remaining integration limitation: source C must bound snapshot reads before JSON parsing; the report service validates the received data after those reads.
