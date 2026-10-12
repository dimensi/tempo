# workouts

## Scope and acceptance

Branch `feat/workouts`, isolated worktree database `file:./.data/development.sqlite`; no demo/production data. Owned workout feature, server, contracts, schema file, routes and dedicated tests only.

Owner and explicitly granted trainer create/edit/delete plans containing dated workouts and exercises with per-set repetitions and planned kg (null means bodyweight). Owner alone records/edits/deletes actual sessions, with completed/in-progress/skipped status and notes. Actual exercises and the original plan snapshot are stored independently. Plan edits/deletion never rewrite history. Revision preconditions reject stale updates/deletions with 409. All data operations require an owner scope and authorization on each public server entry.

## Contract/API

`src/contracts/workouts.ts` exports version 1 `WorkoutPlan`, `WorkoutSession`, `WorkoutPlanInput`, `WorkoutSessionInput`, `WorkoutSessionCreate`, `WorkoutsData` and Zod validators. Sets are arrays `{ reps, weightKg }`; plan workouts each have a stable ID. A session can reference a plan/workout pair or be independent. A referenced session records `{ planTitle, workout }` in `planSnapshot` at creation, immutable during subsequent actual corrections.

Public authorized server API in `@/server/workouts`: `listWorkouts(headers, ownerId)`, `create/update/deleteWorkoutPlan`, `create/update/deleteWorkoutSession`. List returns `{ contractVersion: 1, source: 'user', plans, sessions }`, with plans by creation time and sessions by date. Reports/analytics can compose this API; comments can resolve targets by plan/session ID in these DTOs. Persistence repository is internal and must not be called from other modules.

HTTP: `GET /api/workouts?ownerId=…`; `POST /api/workouts/{plans,sessions}?ownerId=…`; `PUT/DELETE /api/workouts/{plans,sessions}/[id]?ownerId=…`. PUT body `{ revision, data }`, DELETE `{ revision }`. All mutations require matching Origin. Success `{ contractVersion: 1, source: 'user', data }`, errors `{ error }` and 400/401/403/404/409/500. No upstream/raw errors.

## Integration dependencies and checks

Core must add owner-only `workouts:log` (available on `feat/domain-core`). Coordinator must register both `workoutPlans` and `workoutSessions` in Drizzle schema discovery and generate/review/apply SQL + metadata serially. This feature intentionally contains no migration and makes no core/shared changes. Runtime uses the common `getDatabase()` connection; JSON columns are validated into DTOs on read.

For the current flat auth schema, discovery can use `schema: ['./src/server/db/schema.ts', './src/server/db/schema/*.ts']`. Do not re-export this feature from the same auth schema file while this feature imports `user` from it: that would introduce a cycle. If a central schema entry is desired, first move auth tables into their own leaf file and coordinate imports.

Dedicated contract unit tests, in-memory SQLite persistence and real guards integration tests cover snapshots, revisions, scoped queries, grants/revocation and owner-only logging. Dedicated Playwright tests use real Better Auth sessions and `.data/e2e.sqlite` only, with test DDL for these two tables until coordinated migrations land; they do not validate production migrations. Browser scenarios cover forms, plan → actual → plan edit/delete → stable history, trainer access/revocation, cross-owner/foreign-origin rejection and mobile overflow. Core smoke tests remain untouched.

TransformMate catalog selection attaches a stable exercise ID and occurrence UUID; manual exercises remain available and save locally. The server projects supported saved plans automatically. Catalog/detail requests cancel when superseded; teaching Video.js players mount only on explicit request, preload nothing and dispose on close. Private media uses the same-owner server route rather than exposing tokens or upstream URLs.

The sync panel loads persisted state, refreshes after saving and while visible on focus or every 60 seconds, and supports manual verification/retry. It displays safe reasons, checked time and exact current metrics/completion flags alongside planned sets. Published plan edits remain local with a conflict reason; copying to a new starting date creates fresh workout/occurrence identities using UTC calendar-day arithmetic. It retains titles, descriptions, comments and planned sets, without actual results. History retains immutable published snapshots and current remote results even when a local plan is deleted; remote actuals have no edit/delete controls. Manual local sessions remain independent.

Dedicated `copy-plan.test.ts` covers date shifts across DST and fresh identities. `transformmate-ui.spec.ts` uses real authentication/local plan persistence with synthetic catalog/sync responses, covering desktop/mobile catalog selection, lazy player disposal, conflict and actual metrics, copy and orphan result history. Dates are explicit ISO local days; kg is explicit and nullable. Social features and a calendar view remain deferred.

## Separate editor page

`/workouts/new?date=YYYY-MM-DD` opens an unsaved workout. `/workouts/plans/[planId]/edit?workout=[id]&date=YYYY-MM-DD` edits one workout; omitting `workout` edits the entire plan. Pages derive owner scope from granted access and check `workouts:plan`. Editing one workout preserves other workouts and the existing period; a new workout's period follows its date. Back returns the source day; Save opens the saved day.

Names are optional and intentionally empty strings remain stored. Display titles use the ISO calendar day in Russian without timezone shifts. Only TransformMate create/update projections fill its required upstream name. Snapshots retain the original blank name.

Catalog search is inline, sets use compact rows, and comments/order are secondary controls. Save is sticky with safe-area padding. Single-workout copy retains only planned exercises, sets, comments and optional name, with fresh workout/occurrence IDs. It copies no actual results, completion, native training IDs or sync state, and writes nothing until Save.

Session drafts are scoped by authenticated actor, owner, resource/workout, revision and source day. Limits are eight drafts, 256000 characters each and twelve hours. Restore follows server authorization and a fresh access check. Save, explicit cancellation, logout/account switch and denied access clear drafts. Errors preserve fields and the original revision; POST retries keep the Idempotency-Key. Storage-disabled editing retains in-memory fields and warns before unloading.
