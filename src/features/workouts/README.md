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
