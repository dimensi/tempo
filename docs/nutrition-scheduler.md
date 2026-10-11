# Nutrition scheduler

## Activation and runtime

`ENABLE_NUTRITION_SCHEDULER` accepts only `true` or `false` and defaults to `false`. Enable it only after connect/import/disconnect and manual-sync consumers use the common service. The supported runtime is one production Next.js Node server with local SQLite, existing `BETTER_AUTH_SECRET` and an operator-configured encrypted `YAZIO_TOKEN_FILE`. No extra worker, cron service, persistent key or authentication session is created.

`src/instrumentation.ts` registers the timer only for production Node outside the build phase with an explicitly enabled flag. Registration does not read SQLite/tokens or contact upstream. The first poll is delayed 30 seconds; polls then run every 30 seconds to check persisted due times. The hourly job belongs to the server process and does not depend on a browser remaining open. `schedulerActive` reports an actually registered runtime timer with valid configuration; `enabled` separately describes the owner's persistent connection schedule.

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

Connection consumers validate IANA timezone and history dates, including future/reversed bounds, before exchanging credentials. After a successful connect or token import, call `enableNutritionSchedule` with the validated metadata. Its first due time is one hour later so the browser's initial manual history request can acquire the lease first. Disable the schedule before awaiting token disconnection: the epoch changes immediately, rejecting pending job writes. Disconnection preserves existing diary/photo data. Reconnection resets due/retry metadata but retains any existing lease until the running operation drains or expires.

Manual sync handlers replace direct client construction and `syncNutritionPeriod` calls with `runNutritionSync(..., { mode: 'manual', timezone })`. The common service acquires the SQLite lease before reading a token or constructing a refresh-capable upstream client. Do not construct that client in the route first. Consumers expose `getNutritionSchedule(ownerId)` through their authorized status DTO/UI; the DTO includes enabled/runtime-active flags, timezone, initial history date, last success, sanitized error, next due time, retry attempt and running flag.

The service and schema can be tested independently; they are not a complete user-facing hourly feature until all consumer hooks and manual paths are integrated and verified. The deployment flag must remain disabled before that point.

## Dates, history and legacy connections

Every scheduled attempt refreshes exactly the last seven calendar dates including today in the validated owner timezone. It does not interpret upstream meal timestamps as timezone evidence. New connect/reconnect sets the timezone from validated browser input. A manual request can update that timezone and preserves the earliest explicitly selected history `from` as `initialFrom`; subsequent hourly runs do not overwrite it or repeatedly reload all history. The UI can use this metadata to restore the user's selected history boundary. History synchronization remains a manual operation.

When the app finds an existing OWNER connection with no schedule row, a delayed production poll acquires a lease and loads only a Boolean token-presence result inside the app. A connected legacy owner is adopted with UTC fallback and a due catch-up run; no human timezone is guessed. Missing/disconnected storage creates a disabled schedule with `NOT_CONFIGURED`. Existing disabled rows are never silently re-enabled by status or polling. New connection hooks enable them explicitly.

## Lease, restart and retries

`nutrition_schedule` persists owner scope, enabled state, timezone/history, schedule epoch, last success/error, next due time, retry attempt and lease UUID/start/expiry. The owner FK cascades on deletion. Root generates and reviews its versioned migration; no production schema push is used.

Manual and automatic runs share the same owner lease. Claim is atomic; heartbeat runs every 20 seconds with a 120-second TTL. Renewal requires matching UUID, epoch and a still-unexpired lease. It cannot revive an expired lease, and a run is capped at two hours. Source/image operations check fencing before and after awaits; repository reads/mutations and refresh saves also check fencing. Upstream work never awaits inside a SQLite write transaction. Pending sibling operations drain before releasing the logical lease.

Disconnect/reconnect increments the schedule epoch. A late old result cannot write snapshots/cache/status, change the new due time or re-enable a disconnected schedule. Release compares UUID and cannot clear another run's lease. Terminal reconciliation of an expired own lease can mark its stale running sync status failed only while the UUID/epoch still belongs to that run; it never overwrites a replacement generation. The SDK adapter has bounded waits but does not expose transport cancellation, so fencing also protects late refresh persistence.

After process restart, an overdue enabled schedule is attempted once after the delayed poll and expired-lease claim. Missed hours are not replayed individually. Successful runs set the next due time to one hour after completion. Failed or partial sync uses delays of 1 minute, 5 minutes and 15 minutes, then one hour for further failures. Attempts saturate at 3 and reset after success. Only `NOT_CONFIGURED`, `SYNC_FAILED` and `LEASE_LOST` are persisted as schedule errors.

## Verification commands

The root Vitest configuration includes the dedicated suite, using genuine migrations and synthetic temporary databases:

```sh
pnpm exec vitest run --config tests/nutrition-scheduler/vitest.config.ts
pnpm check
E2E_PORT=3127 pnpm test:e2e
```

Build before the production runtime smoke:

```sh
pnpm build
node tests/nutrition-scheduler/runtime-smoke.mjs
```

The smoke owns temporary DB/files and starts/stops only its own real standalone Node servers. It inherits no production secret/token environment, opens no browser, uses an absent synthetic token path, and verifies delayed registration, legacy disabled adoption, restart/expired-lease recovery and stale-running reconciliation. It must create no credential files and make no upstream request. It removes its fixtures afterwards. Record the actual smoke output and tested head in the PR; a prepared command alone is not a passing result or evidence about production.

Local validation passed on the scheduler working tree using the shared UX calendar helpers: full `pnpm check` (161 tests and production build), all 32 desktop/mobile E2E scenarios on port 3127, and the real standalone runtime smoke. The smoke returned:

```json
{
  "timer": "production-delayed",
  "browserRequired": false,
  "restart": "expired-lease-reclaimed",
  "upstream": "blocked-without-token",
  "credentialFilesCreated": false
}
```

CI must still pass on the final published integration head before merge. Consumer hooks/UI integration is a separate acceptance step before enabling deployment. These synthetic checks do not establish live account synchronization or production scheduler activation.
