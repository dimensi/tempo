# Report integration and runtime handoff

Owned implementation: `src/server/pdf`, reports UI/routes, v1 report request and report tests. No DB migrations, shared auth or Docker changes in this branch.

Reports use authoritative `NutritionDay.totals`; derived metrics are an exact decimal period sum and explicitly labelled energy shares. Missing dates and null nutrients remain unknown with separately labelled known totals. An empty dataset is 404, never an invented zero day. HTML/PDF share escaped content, source values, colors and photo selection. PDF embeds three bundled Cyrillic fonts; HTML uses the incumbent Arial/system-ui stack without embedding fonts. HTML preview flows without A4 measurement; only PDF is paginated. No Chromium navigation to an internal endpoint: `page.setContent`, fresh context, no cookies, JavaScript disabled, all network blocked, data images/fonts only. Response is private/no-store with CSP and sandbox. Every request uses `reports:export` and owner scope, repeated before releasing output.

Numerical text uses the shared `formatDecimal` presentation helper: ordinary values have at most two decimal places, very small/large values have bounded text, and nonzero deltas below display precision show `≈ 0`. Null remains unknown; source decimals and exact period calculations are unchanged. The form initializes both date fields once from the browser's local calendar after hydration, preserving edits and explicit clearing across period changes.

## Source C integration

`reportDataSource(headers)` statically imports source C and composes its authorized public interface through `createNutritionReportSource`. There is no demo fallback or global test setter. The adapter preserves the agreed DTO without conversion or nutrient recalculation:

Daily HTML and PDF sections prominently show steps from the existing authenticated health reader for the same owner and calendar range. The source checks that the requested owner matches the session's accessible owner before reading; the health reader enforces `measurements:read` with owner scope. Zero steps remain zero; missing values display `—`. No steps are inferred from nutrition or converted to calories. The optional current owner goal is read with `reports:export`, never taken from the export query. A missing goal hides goal/progress entirely. Period summaries average only observed days (including real zeros) and disclose coverage. The current goal applies to historical dates in newly generated reports.

Task scope: `src/server/pdf`, `src/features/reports/messages.ts` and report tests; existing v1 report/nutrition/health contracts, no schema changes. Acceptance: real PDF text contains date-specific steps, zero and unknown remain distinct, canonical day still fits A4, owner/trainer guards remain enforced.

The handler passes request headers to the adapter; Chromium never receives them. The reports page uses `getAccessibleOwnerId(await headers())` from `@/server/access/owner`. No trainer owner-ID input is exposed; a missing grant disables export controls. The helper does not replace the route guard.

Source C must bound source reads before materializing days/photos; this service bounds the received dataset and each private image. Agreed source C methods do not accept AbortSignal; cancellation is checked before/after each read. There is no upstream request from the reports path.

## Runtime requirements

Playwright is a production dependency and an external server package. Chromium must match its locked revision. Only PDF requires Chromium: the trusted server prepares exact A4 pages after font loading, photo decoding/orientation, long-side downsampling to at most 1200 pixels and measured pagination. HTML returns the escaped template directly, with natural-flow date headers; it never launches Chromium or calls page.pdf. Preview pagination may differ from Download. Built-in PDF headers are disabled; the template supplies A4 headers, footers and global page numbers. Rendering fails with sanitized 503 on missing fonts/browser, invalid selected images or unresolvable overflow.

DejaVu 2.37 Sans regular/bold and Serif regular are bundled in `fonts/`, including the upstream license. No host font fallback or `PDF_FONT_PATH` is used. Font files and license are statically read for standalone tracing, each bounded to 2 MiB. No public report files or persistent browser process.

The compact daily layout uses 11.3 mm side margins, a 20 pt serif heading, four horizontal totals, two equal chart panels with 3.2 mm strips and one shared food table. The canonical four-meal, six-record, three-photo fixture fits one A4 without scaling or reducing individual font sizes. Period reports retain their aggregate overview and start each calendar day on a new page.

Macro shares use calculated 4/9/4 energy, separately from diary calories. Diagram widths use unrounded decimal ratios; largest remainders distribute displayed tenths of a percent to exactly 100%. Missing, invalid or zero-energy macros hide the strip and show `—`. Source values remain unchanged, including source quantities, servings and zero consumed portions.

One photo is selected per owner/calendar date/meal: the single YAZIO photo takes priority; otherwise the newest manual photo is used, with a stable ID tie-break. Existing stored photos are unchanged. Multiple upstream photos for one meal are invalid. Each thumbnail is a 31.75 mm square with centered `object-fit: cover`, preserving source orientation and proportions. Meals without photos have no media figure; entries retain their existing grid column.

Pagination loads all three fonts explicitly before measuring, decodes photos, keeps a meal intact when it fits a fresh page and splits oversized meals between entries. Continuations repeat the meal name and column labels, preserve the photo-column alignment and show neither the photo nor meal totals again. A single oversized title may continue across pages; its metadata and nutrients appear once, with numeric values at the first title line. Numeric column widths are measured without shrinking fonts; text is never clipped.

CI installs the locked Chromium before Vitest and includes Poppler (`poppler-utils` on Debian; `poppler` on Homebrew), because the report integration test generates PDFs and inspects extracted Cyrillic, embedding, A4 geometry, image dimensions, every pages nonblank content and text clipping. No silent skip for missing runtime/tools.

## Limits and verification

Max 31 days, 3000 entries, 60 raster photos, 8 MiB each (aligned with source C) / 20 MiB total, 16 million pixels each / 32 million total, 8 MiB source JSON, 40 MiB HTML. PDF cancellation closes the fresh Chromium browser and releases the report slot, including during pagination. HTML cancellation is checked between source reads and before returning its template. The latest preview selection is debounced in the browser; PDF keeps its measured page layout. One full report request at a time in the supported single Next process, no unbounded queue. Browser launch max 15s, rendering max 25s with finally-close; data abort after 45s checked between source reads. Source strings max 1500 characters, summed decimals max 80 characters and exponent magnitude 100. No DB transaction spans rendering.

`tests/integration/pdf-rendering.test.ts` runs a genuine generator on synthetic days and a synthetic 2:1 raster photo for daily/weekly/custom periods. Optional `PDF_VERIFICATION_DIR` (existing directory) saves a PDF and raster screenshots for manual review. No personal data is used. `pdf-authorization.test.ts` exercises actual SQLite grants with a session fixture, including mid-generation revocation; E2E uses real Better Auth and no mocked security session.

`tests/e2e/reports-persisted.spec.ts` uses the disposable E2E DB for a synthetic persisted snapshot, uploads a synthetic 2:1 PNG through the authorized nutrition API, previews HTML and downloads a real PDF through the UI. It extracts Cyrillic and photo metadata from those actual downloaded bytes, then checks a real trainer session without grant, with grant, and after revocation. The real rendering integration test also exercises a valid PNG larger than 3 MiB.

The report form keeps controls disabled until hydration, so cold navigation cannot discard dates entered before React attaches event handlers. The persisted E2E deliberately holds client scripts to verify this, then exercises the same preview and PDF assertions after release.

Remaining integration limitation: source C must bound snapshot reads before JSON parsing; the report service validates the received data after those reads.

`pdf-redesign.test.ts` verifies a one-page six-record synthetic example, no/four photos, long meals, an oversized title, large numbers, unknown/zero macros, real EXIF orientation and multiple dates. It checks real PDF text geometry and nonblank pages; `PDF_VERIFICATION_DIR` saves synthetic PDFs and selected page rasters for visual review.

HTML retains bounded data-URI photos. The existing opaque iframe sandbox and `img-src data:` CSP do not permit authenticated image URLs without changing security policy. Authorized private image bytes are still read and embedded before the response; HTML does not read or embed PDF fonts, and HTML skips image decoding/downsampling entirely, so its payload may be larger than prepared PDF thumbnails. No arbitrary remote image URLs, persistent report cache or browser pool are introduced.
