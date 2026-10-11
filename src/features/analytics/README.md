# Analytics

Owned feature UI and pure range/summary helpers. Server composition lives in `src/server/analytics`; it authorizes both nutrition and measurement reads against the requested owner before invoking either source. No schema or migrations.

Rolling week = 7 inclusive days; rolling month = 30 inclusive days; custom periods contain 1–366 days. Nutrition totals use decimal.js with addition precision derived from occupied decimal positions. Means divide the exact sum at 40 significant digits; rounding to two decimal places is only a presentation step. Each nutrient has its own confirmed-day denominator. Missing days stay null, and known partial totals never replace full totals. Duplicate dates are rejected.

Measurements use the upstream Measurement contract and are filtered by measuredAt. The browser DTO omits ownerId and notes. Production reads real scoped loaders; no demo data or fallback source. No expenditure or deficit calculation.

Required coordinated dependencies: `@/server/nutrition.listNutritionDays`, `@/server/measurements.listMeasurements`, `@/server/access/owner.getAccessibleOwnerId`, `@/contracts/measurements`, and global Mantine charts CSS.
