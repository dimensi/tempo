# Unified workout implementation

Verification: Full; shared contracts, schema, offline writes and consumers change. New test cases: 0. Extend existing integration and browser smoke cases. No merge/deploy authorization.

Canonical local contract: `Workout`, `WorkoutInput`, `WorkoutAction`, `WorkoutsData {contractVersion:2, source:user, workouts}` in contracts/workouts.ts. `WorkoutInput` includes date/title/note/exercises/status. Provider publication schemas are isolated in contracts/workout-publication.ts; they are transport snapshots, never a second local workout.

Repository contract: list(ownerId), get(ownerId,id), create(ownerId,data,requestId?), update(ownerId,id,revision,data,action?,requestId?), delete(ownerId,id,revision), assertRevision(ownerId,id,revision). WorkoutError carries status. Create requires planned; ordinary update keeps status and rejects completed. start planned->in_progress, complete in_progress->completed, resume completed->in_progress. Start/complete require at least one exercise and one valid set per exercise. resume retains values. Occurrence IDs are stable UUIDs. API retries with same requestId are idempotent; same ID with different input conflicts.

Services: listWorkouts(headers,ownerId), createWorkout(headers,ownerId,data,requestId?), updateWorkout(headers,ownerId,id,revision,data,action?,requestId?), deleteWorkout(headers,ownerId,id,revision). Trainer may create/update/delete planned only; OWNER may edit planned/in_progress and transition.

Routes: GET/POST /api/workouts, PUT/DELETE /api/workouts/[id], POST /api/workouts/[id]/transition. POST body {ownerId,requestId,data}; PUT {ownerId,revision,requestId,data}; transition {ownerId,revision,requestId,data,action}. Remove local plans/sessions endpoints.

Offline payload: {kind:workout,data:WorkoutInput,action?:WorkoutAction}. Owner saves/transitions use durable queue; trainer uses API. Explicit removal of saved occurrences uses protected online API with existing confirmation and video cleanup.

DB: workouts export in schema/workouts.ts. workoutVideos.workoutId replaces sessionId DB property and column. Existing public video contract can still carry sessionId as transport field until changed coherently by consumer worker; it must resolve workouts. TransformMate links retain provider publication identity columns; migration maps both plan_id/workout_id to canonical workout ID, preserving link IDs/markers and remote IDs.

Coordinator owns contracts, db/schema, drizzle, shared offline/read layer, fixtures/tests/docs. Worker server owns server/workouts except videos.ts, server/workouts/transformmate/** and app/api/workouts except videos and transformmate. UI owns features/workouts and dashboard workouts route. Consumer owns server/workouts/transformmate/**, server/workouts/videos.ts, overview/MCP/comments targets, transformmate replica consumer. Each worker has its own branch/worktree; no shared edits.
