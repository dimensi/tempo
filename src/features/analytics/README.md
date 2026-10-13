# Analytics

The selected-period screen follows summary → changes → trends → disclosed records. Mantine, Arial and the shared teal theme remain unchanged. There are no new dependencies, tables or migrations.

## Period and comparisons

Browser timezone is resolved before loading user-facing data and is included in the URL. Presets cover 7, 30 and 90 inclusive days; custom periods contain 1–366 days. The previous period ends the day before the selected period and has the same length. Navigation preserves browser history. A mean comparison requires at least 70% fully filled nutrition days (or observed steps days) in **both** periods. Absolute change remains available if the prior mean is zero; percentage change is unknown.

## Nutrition and quality

The existing exact decimal summary remains shared with Overview. Analytics adds its own filled-day projection: a saved day without food entries is `empty`, an absent day is `missing`, a day with entries and all four known totals is `complete`, and a day with entries but unknown totals is `partial`. Empty raw zeroes remain available in the disclosed table but do not establish a filled day or participate in analytics means. Known zeroes on days containing entries still count. Quality measures recorded completeness, not whether the person logged every consumed meal.

Each nutrient mean uses its own eligible denominator. Unknown totals and known partial totals never substitute for each other. Calories use daily bars and a confirmed-day mean reference line; partial known calories are hatched and missing/empty diaries are gaps. Macro averages and energy shares use a single cohort with known protein, fat and carbohydrate totals. Shares are normalized by protein × 4 + fat × 9 + carbs × 4, not by reported calories. Zero total macro energy has no invented ratio.

## Body and activity

Weight combines canonical measurement records (manual or body-synced) and the existing unlinked owner-confirmed-kilogram YAZIO history. Existing float32 read projection is applied before comparisons, while raw imported values remain in the DTO. Observations and sources are retained separately, including duplicate dates and null imported values. Conflicting values on the first/latest date suppress ambiguous endpoint values and deltas rather than choosing a source or averaging. Weight rate is delta × 7 / actual elapsed days between endpoint observations, available only for periods of at least seven days and distinct observation dates. Other measurements expose first/latest/delta. The chart uses calendar-time spacing. Visible chart dots preserve observations; lines break for gaps longer than seven days.

Steps are daily bars with observed zeroes and missing gaps. Means exclude missing values. Nutrition and steps show their own latest stored observation timestamp and an owner-only link to the existing settings sync flow; this is not a claim that all records were refreshed at that time.

## Composition and access

`src/server/analytics` authorizes nutrition and measurement reads against the requested owner before loading and again afterward. Failures of nutrition, body or steps have independent block states. Failure of previous-period reads keeps current data visible but removes comparison. Authorization failures remain full denials, including a trainer grant revoked during loading. DTOs omit notes, owner IDs and upstream secrets. `/analytics/data` returns the same new composition with private no-store caching; it replaces the old response directly.

Highlights use deterministic rules (at most four lines), never goal-free good/bad judgments. Tables and calculation explanations are disclosed on demand. No expenditure, deficit, medical assessment, goals, correlation, forecast, workout analytics or rolling average is included.

Verification covers cohort semantics, precision, equal-length date ranges, source ambiguity, actual observation rate, zero denominators, independent failure/recovery, access revocation, URL navigation and desktop/mobile rendering in both themes. Fixtures are synthetic and confined to disposable test databases.

The production browser harness excludes offline tests from the general family. The rolling-calendar offline fixture now uses the browser timezone consistently and a fixed instant near midnight, tested in both UTC and Europe/Moscow. Analytics fixtures use real sessions on the isolated HTTPS gateway and keep service workers blocked to test server reads and access revocation.
