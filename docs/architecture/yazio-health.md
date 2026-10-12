# YAZIO health read adapter (v1)

This isolated adapter is not enabled in the scheduler or UI. No health writes are available or invoked. Tests use synthetic payloads and mocked fetch only.

## Verified vendored contract

Source is the pinned archive `vendor/yazio/upstream-source.tar.gz` at SDK revision `89386f0db1ef15bc2bb21b359805d83c9fc7bbf7`; generated implementation references below are in `vendor/yazio/dist/sdk.js`.

- Lines 413–438, upstream `src/api/user/bodyvalues/weight.ts`: `user.getWeight({date})` reads `/user/bodyvalues/weight/last?date=YYYY-MM-DD`, returning a nullable record with UUID `id`, string `date`, nullable number `value`, nullable strings `external_id`, `source`, `gateway`. It is the last entry, not a history list. A daily sweep can miss multiple same-day entries and is not a complete history API.
- Lines 550–609, upstream `src/api/user/summary.ts`: `user.getDailySummary({date})` reads `/user/widgets/daily-summary?date=YYYY-MM-DD`, including numeric `steps` and string `units.unit_mass`. Missing or null steps are unknown, explicit zero is zero. Exercises also contain steps but are not summed into this daily total.
- Lines 699 and 572: profile and summary mass preferences are unrestricted strings. No weight unit field, enum, conversion, or association between preference and raw weight value is established in this SDK. The imported record retains `rawValue`, `unit:null`, and optional `unitContext` metadata; it must not enter a kg chart or the manual kg contract.
- Upstream `src/utils/date.ts` converts Date/string to UTC ISO date. Callers validate and pass date-only strings, avoiding server-local Date construction. Weight provider dates are unrestricted strings. Only exact valid YYYY-MM-DD becomes `measuredDate`; timestamp strings retain their raw date and have no fabricated local day.
- Archived bodyvalues source contains only weight. No circumference reads or health write methods exist in the facade (lines 743–782). SDK health reads return typed JSON without runtime validation; this adapter validates independently.

## Integration freeze and root-owned schema proposal

New files expose `yazioHealthUpstream(existingClient.user)`, `normalizeHealthSummary(rawSummary,date)` for eventual shared summary fetch, and UUID deduplication. They create no connection, schedule, persistence, or authorization surface. The caller must reuse the existing owner lease, assert its epoch/generation after awaiting, and preserve prior health data on failures. `HEALTH_READ_FAILED` is separate from nutrition outcome/status.

Proposed root-owned tables: `yazio_weight_entries` keyed uniquely by `(owner_id,external_id)` with provider_date, measured_date nullable, raw_value nullable, unit null, unit_context nullable, upstream_source/gateway nullable and observed_at; `yazio_daily_steps` uniquely keyed by `(owner_id,date)` with nullable nonnegative integer steps and observed_at. Owner foreign keys cascade. Last-weight absence is not proof of deletion, so retain earlier entries. No migration is generated here.

Authorized combined readers should keep local measurement CRUD intact, label provenance, preserve separate local/provider records, and project only weights with corroborated units into existing kg charts. Unknown raw records need a visible unit explanation. Daily steps use missing/null rather than synthetic zero for unavailable days. Existing trainer grants and permissions remain unchanged. Scheduler, summary-fetch reuse, schema generation, authorized readers, UI and synthetic security E2E are coordinated follow-up work.
