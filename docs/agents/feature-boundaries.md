# Feature ownership

| Area              | Owned paths                                                                             | Public contract                   |
| ----------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| YAZIO integration | src/server/yazio, src/server/jobs                                                       | normalized v1 + reviewed adapters |
| Nutrition diary   | src/features/nutrition, src/app/(dashboard)/diary                                       | NutritionDay/Meal/Entry/Totals    |
| Measurements      | src/features/measurements, src/app/(dashboard)/measurements                             | Measurement                       |
| Workouts          | src/features/workouts, src/app/(dashboard)/workouts                                     | Workout/WorkoutExercise           |
| Analytics         | src/features/analytics, src/app/(dashboard)/analytics                                   | agreed derived data contract      |
| PDF reports       | src/features/reports, src/app/(dashboard)/reports                                       | agreed report request/result      |
| Trainer comments  | src/features/comments, dedicated route after coordination                               | agreed comment contract           |
| Core              | auth/db, contracts, components, config/styles/lib, dependencies, CI, Docker, navigation | coordinated separately            |

Task-specific unit/integration tests are owned by the feature agent; avoid all agents editing the shared smoke test. Route handlers/server actions accessing DB remain server-only; server implementation can be placed under a clearly assigned `src/server/<feature>` after agreeing ownership. Do not put a DB import into UI feature files.

No direct feature-to-feature imports; data exchange uses shared contracts and server composition. No cycles. A shared type must be accepted before dependent modules proceed. Schema/migrations are coordinated serially to avoid independent snapshot collisions. Additive features must preserve existing shell and security checks.
