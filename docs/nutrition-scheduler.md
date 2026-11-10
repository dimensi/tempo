# YAZIO refresh and write delivery

The production timer refreshes today and yesterday for connected owners in their saved timezone, within the saved history start. Opening or refocusing the owner overview can also trigger the same refresh. Both entry points claim the common lease and persist the same hourly attempt limit, including failures. GET status, prefetch, trainer views and MCP reads only read saved data.

The owner selects one history start. History loading covers that date through today (up to 366 days per request), using checkpoints for older dates. The separate seven-day refresh rereads recent entries, bounded by the saved start. It preserves the saved start, timezone and automatic attempt timestamp. A successful manual run establishes freshness only when it fetched food, steps and goals for every automatically eligible date.

Steps are saved after each daily summary, independently of food, weight and goals. Food is saved after validating the day and resolving its product and recipe references. The shared adapter deduplicates the daily summary request. Photos are fetched after steps and food, committed separately, and keep previous bytes for failed slots. Manual photos are untouched. The owner-only sync status endpoint reports active stages, pending photo dates and the last outcome. Visible screens refresh saved values during a run without waiting for its photos.

`yazio_daily_goals` stores owner/date, nullable base calories as exact decimal kcal text, nullable positive integer steps, nullable target weight as decimal kg text and fetchedAt. `/user/goals/unmodified?date=...` supplies base energy without activity additions. Its `energy.energy` key uses kcal, matching food nutrient energy; `activity.step` is a step count. Missing/zero inactive goal values become null; invalid payloads preserve the last successful observation. Each goals read uses existing bounded GET retries and authentication/connection/lease fences. Failure does not cancel food or health persistence or clear prior goals.

Manual and automatic runs share the persisted UUID/epoch lease: 120-second TTL, 20-second heartbeat and two-hour maximum. Upstream awaits occur outside write transactions. Disconnect/reconnect increments epoch; every token refresh/read and synchronous persistence is fenced. Late old-account results cannot write data or statuses. Pending operations drain before lease release. `lastSuccess` still records complete food refreshes; hourly freshness has separate paired-date success fields. Sanitized food/photo status remains distinct from auxiliary failures.

`ENABLE_NUTRITION_SCHEDULER=true` enables the production 30-second sweep for both due nutrition reads and pending measurement writes. The durable lease and timestamps govern the hourly read cadence across process restarts. The existing measurement-write retry and reconciliation continue independently. Overview refresh remains available with a configured connection when the production timer is disabled.

Settings shows the three read-only goals (calories, steps and target weight) for the current date in the saved timezone. The previous manual steps setting remains stored but is never read or written. Diary uses the selected date. Analytics reference lines leave gaps for unknown goals; calorie deviation uses paired known calorie/goal days with entries, and steps achievement uses paired known steps/goal dates; both exclude today from final assessments. Reports use historical daily goals, with period progress equal to sum(steps)/sum(goals) over matching known dates. MCP reads expose saved dated goals without synchronization.

Verification: existing migration and nutrition-sync integration cases cover fresh/upgrade preservation, dated goals, failure retention, hourly cooldown, a lease race and successful/unsuccessful manual freshness. No new cases were added. Final Full verification uses `pnpm verify:merge` after independent review.

## Runtime diagnostics

Filter the application's **Runtime Logs** in Coolify for `yazio_` (deployment
build logs are a different stream). Events are one-line JSON with a UTC `at`.
For Moscow time add three hours. Existing `yazio_read_*` and `yazio_sync_failure`
request diagnostics remain available.

- `yazio_scheduler_started`: the production Node.js interval was installed,
  with `intervalMs: 30000`. Registration makes no immediate upstream request.
- `yazio_scheduler_disabled`: `feature_flag_disabled` or
  `connection_not_configured`. Build/development/Edge processes do not start the
  timer. Invalid server configuration logs `yazio_scheduler_failed` at
  `registration` and is still thrown, not silently accepted.
- `yazio_scheduler_skipped`: `no_enabled_owners`, `connection_disabled`,
  `history_start_in_future`, `run_in_progress`, `attempt_cooldown`,
  `recent_success`, `lease_conflict` or `connection_not_configured`.
  `trigger` distinguishes `timer` from `overview`. Cooldowns include the UTC
  `nextEligibleAt`; the next sweep can be up to 30 seconds later. A running lease
  or changed connection can still defer it. Identical skip states are logged
  once per internal scope per hour, not every sweep.
- `yazio_sync_started` and `yazio_sync_completed`: an ephemeral `runId`, mode,
  trigger (`timer`, `overview`, or `request`), duration and failure counts. The
  completion `outcome` is `success`, `partial`, or `failed`, including auxiliary
  failures rather than inferring success from food alone.
- `yazio_sync_failed`, `yazio_sync_auxiliary_failed`, and
  `yazio_scheduler_failed`: bounded error categories/codes only. Tick failures
  include synchronous DB/composition errors, do not kill the timer, and repeated
  identical failures are suppressed until recovery or an hourly reminder.
- `yazio_scheduler_stopped`: an installed timer was explicitly stopped.

No owner identifiers, record payloads, paths, credentials, environment values,
raw errors or stacks are emitted by lifecycle diagnostics. No diagnostic endpoint
or new permissions are added. The existing hourly limits, lease and persistence
rules are unchanged. A startup message proves registration, not a successful sync;
use the subsequent trigger, skip reason and completion together. Older releases
lack these lifecycle events, so their silent logs cannot prove timer health.

The existing nutrition integration scenario now invokes actual `register()` and
advances its real interval with a fake clock and synthetic IO. It checks build
and disabled guards, one timer on repeat registration, a no-browser run, cooldown
noise suppression, synchronous tick failure/recovery, safe error output and stop.
Test-case count is unchanged; no new E2E scenario is added.
