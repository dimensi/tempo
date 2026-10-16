# Nutrition scheduler

## Activation and runtime

`ENABLE_NUTRITION_SCHEDULER` accepts only `true` or `false` and defaults to `false`. Enable it only after connect/import/disconnect and manual-sync consumers use the common service. The supported runtime is one production Next.js Node server with local SQLite, existing `BETTER_AUTH_SECRET` and an operator-configured encrypted `YAZIO_TOKEN_FILE`. No extra worker, cron service, persistent key or authentication session is created.

`src/instrumentation.ts` registers the timer only for production Node outside the build phase with an explicitly enabled flag. Registration does not read SQLite/tokens or contact upstream. The first poll is delayed 30 seconds; polls then run every 30 seconds to check persisted due times. The four-hour job belongs to the server process and does not depend on a browser remaining open. `schedulerActive` reports an actually registered runtime timer with valid configuration; `enabled` separately describes the owner's persistent connection schedule.

No upstream client is constructed without a configured secret/path and a loaded non-null encrypted token. Missing, disconnected or unreadable storage never triggers token refresh or food requests. Failures are recorded using sanitized codes rather than raw upstream errors.

## Integration contract

The public server entry is `@/server/jobs/nutrition-scheduler`:

```ts
enableNutritionSchedule(ownerId, { timezone, initialFrom }): void
disableNutritionSchedule(ownerId): void
getNutritionSchedule(ownerId): NutritionScheduleStatus
runNutritionSync(ownerId, { from, to }, { mode: 'manual' | 'scheduled', timezone? }): Promise<SyncStatus>
```

These are internal services, not an authentication replacement. HTTP callers must keep `yazioOwner`, same-origin enforcement and input validation. The service independently verifies that the DB subject is the single OWNER. A trainer session must not be allowed to call sync or schedule-management endpoints. Status reads do not initialize, enable or mutate schedules.

Connection consumers validate IANA timezone and history dates, including future/reversed bounds, before exchanging credentials. After a successful connect or token import, call `enableNutritionSchedule` with the validated metadata. Its first due time is four hours later so the browser's initial manual history request can acquire the lease first. Disable the schedule before awaiting token disconnection: the epoch changes immediately, rejecting pending job writes. Disconnection preserves existing diary/photo data. Reconnection resets due/retry metadata but retains any existing lease until the running operation drains or expires.

Manual sync handlers replace direct client construction and `syncNutritionPeriod` calls with `runNutritionSync(..., { mode: 'manual', timezone })`. The common service acquires the SQLite lease before reading a token or constructing a refresh-capable upstream client. Do not construct that client in the route first. Consumers expose `getNutritionSchedule(ownerId)` through their authorized status DTO/UI; the DTO includes enabled/runtime-active flags, timezone, initial history date, last successful complete food update, sanitized error, next due time, retry attempt and running flag.

The service and schema can be tested independently; they are not a complete user-facing scheduled feature until all consumer hooks and manual paths are integrated and verified. The deployment flag must remain disabled before that point.

## Dates, history and legacy connections

Every four hours, refresh today and yesterday in the saved timezone, never before initialFrom. Scan persisted progress to fill missing historical dates and parts, with at most 364 old dates plus the recent dates per scheduled run. Fully loaded old days make no upstream requests. The same rule applies to manual ranges; selected-day refresh forces every part without changing saved history, timezone or enablement. Manual ranges remain limited to 366 days. A later manual selection replaces initialFrom; automatic runs do not change it.

When the app finds an existing OWNER connection with no schedule row, a delayed production poll acquires a lease and loads only a Boolean token-presence result inside the app. A connected legacy owner is adopted with UTC fallback and a due catch-up run; no human timezone is guessed. Missing/disconnected storage creates a disabled schedule with `NOT_CONFIGURED`. Existing disabled rows are never silently re-enabled by status or polling. New connection hooks enable them explicitly.

If a connected legacy owner manually syncs before the first delayed poll, claim records that it created a new schedule row. Only that newly created manual row may be enabled after valid token load under the same UUID/epoch fence, using the selected timezone/history and a four-hour due time. An existing explicitly disabled row is never re-enabled by manual sync; disconnect during token loading also prevents late auto-enable.

## Lease, restart and retries

`nutrition_schedule` persists owner scope, enabled state, timezone/history, schedule epoch, last success/error, next due time, retry attempt and lease UUID/start/expiry. The owner FK cascades on deletion. Root generates and reviews its versioned migration; no production schema push is used.

Manual and automatic runs share the same owner lease. Claim is atomic; heartbeat runs every 20 seconds with a 120-second TTL. Renewal requires matching UUID, epoch and a still-unexpired lease. It cannot revive an expired lease, and a run is capped at two hours. Source/image operations check fencing before and after awaits; repository reads/mutations and refresh saves also check fencing. Upstream work never awaits inside a SQLite write transaction. Pending sibling operations drain before releasing the logical lease.

Disconnect/reconnect increments the schedule epoch. A late old result cannot write snapshots/cache/status, change the new due time or re-enable a disconnected schedule. Release compares UUID and cannot clear another run's lease. Terminal reconciliation of an expired own lease can mark its stale running sync status failed only while the UUID/epoch still belongs to that run; it never overwrites a replacement generation. The SDK adapter has bounded waits but does not expose transport cancellation, so fencing also protects late refresh persistence.

After restart, an overdue enabled schedule is attempted once after the delayed poll and expired-lease claim. Missed intervals are not replayed. Both successful and failed runs set nextRunAt to four hours after completion; there are no minute-scale background read retries. Attempts saturate at 3 and reset after complete food/photo success. Outgoing local measurement jobs keep their independent existing policy.

`SyncStatus` separates food/meta failures in `failedDates` from download/storage warnings in required `photoFailedDates`. When `failedDates` is empty, all food was persisted and `lastSuccess` records that food-update time even if photos remain incomplete. Photo-only partial runs record `PHOTO_INCOMPLETE` and retry after four hours. Any food failure takes precedence as `SYNC_FAILED` and retains the previous complete-food timestamp. Lease/epoch checks still gate completion; disconnect or stale lease cannot record a late food success or media warning. This uses the required current contract, not an optional-array compatibility fallback.

## Persistent progress and upgrade

`yazio_sync_progress` stores owner/date completion for food, photos, steps, weight and body values, including successful empty responses. A selected part is marked pending before reads; success is committed in the same synchronous transaction as its data. Old photo repairs preserve food and reuse successful unchanged photo URLs; recent/forced refresh downloads images again. The existing 24-hour product/recipe cache remains unchanged.

Migration 0016 adopts existing snapshots as complete, retaining known food/photo failures from the last stored status. It adds required `skippedDates` to persisted statuses and moves enabled schedules four hours ahead once. Unknown historic gaps in already-saved snapshots are deliberately trusted; use selected-day refresh to repair them. Manual photos alone do not establish a loaded day. Ready skipped dates are reported separately from newly fetched food and do not cause a failed result.

### Transient read failures

Food, summary, photo metadata, product/recipe references, weight and body GET reads
retry only allowlisted transient transport failures (including connect/header/body
timeouts, connection reset and temporary DNS failure). Each read has at most three
attempts, with 500 ms and 1000 ms backoffs and a 45-second read budget. Food and
health share the same per-date summary retry sequence, including its final failure.
Authentication completes before this loop; credential exchange, token refresh,
token persistence, POST and PUT are never replayed by it. Connection-generation
checks run before each attempt and before returning a successful result.

HTTP errors (including 401/403/429/5xx), validation failures, persistence failures
and unknown exceptions are not retried. An SDK request that exceeds the wrapper's
30-second deadline is also not replayed: the SDK does not expose cancellation and
a second attempt could overlap the original. Body GETs use an abortable 20-second
transport timeout within the same budget; body writes retain their single-attempt
transport and existing uncertainty/reconciliation lifecycle. Photo bytes retain
their existing validated CDN/range transport policy; only metadata uses this loop.

`yazio_read_retry`, `yazio_read_failed` and `yazio_read_recovered` identify the
operation, optional date, attempt count and elapsed milliseconds; retry events
include the next delay. `yazio_sync_failure` retains the failing persistence/read
stage and carries the safe underlying category/code or numeric HTTP status and
attempt count where available. Categories distinguish network, timeout, HTTP,
validation, storage and unknown failures. Error messages, stacks, request/response
payloads, owner IDs, product/recipe IDs, URLs and credentials are never logged.
Unknown errors remain unknown instead of being mislabeled as network failures.

Implementation ownership: YAZIO jobs/adapters, nutrition persistence, the coordinated progress schema/migration and sync-status contract, settings text/progress, and associated tests/docs. Authorization and transport payload semantics remain unchanged.

## Verification commands

The former scheduler-specific test harness and standalone runtime smoke were removed with the
low-signal exhaustive suite. The retained migration and nutrition-sync integration checks protect
persisted schedules and durable day data; the YAZIO browser smoke protects the representative
owner sync path. For a scheduler change, choose the narrowest focused check that exposes the
specific regression rather than recreating a permanent timer matrix:

```sh
pnpm exec vitest run tests/integration/migrations.test.ts
pnpm exec vitest run tests/integration/nutrition-sync.test.ts
pnpm exec vitest run tests/integration/yazio-network-retry.test.ts
pnpm test:e2e nutrition
```

Run `pnpm verify:merge` for a Full-tier scheduler, schema, authorization, or deployment change.
Synthetic checks do not establish live account synchronization or production scheduler activation.

## Read-only health imports

The same manual/automatic owner lease now imports daily steps and last-weight reads after completing nutrition. Each run constructs one adapter with a bounded, per-date raw daily-summary promise cache; independent food and health projections share the SDK response, including transport failures. Health validation failures cannot invalidate valid meals. No additional timer, credentials, provider writes, or trainer permissions are introduced.

The returned `health` outcome lists completed and failed steps/weight request dates with sanitized `HEALTH_IMPORT_FAILED` when applicable. A successful null last-weight read completes its request date without creating or deleting records. Repeated last-weight UUIDs are deduplicated before one owner-bound health transaction. Unknown steps remain null, explicit zero remains zero, and raw weights retain unknown units and ambiguous provider dates. These are last-entry observations, not a complete weight-history import.

Food/photo status and last successful food timestamp remain independent of health failures. Schedule completion follows health/body work, so the next interval starts after the run completes. Every health await and synchronous persistence boundary checks the owner lease. Body imports check both the connection epoch and the caller lease before atomically saving the complete date and checkpoint.
