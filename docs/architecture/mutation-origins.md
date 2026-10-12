# Browser mutation origins

Application mutation wrappers share `hasTrustedOrigin()` from `src/server/auth/origin.ts`. It compares the browser `Origin` with the configured public `BETTER_AUTH_URL` origin. Internal HTTP request URLs behind an HTTPS reverse proxy and untrusted forwarding headers never determine the trusted origin. Authentication, capabilities and owner scope remain separately enforced by each domain service.

The audit found one internal-URL comparison: measurements. It rejected valid owner browser writes behind the production reverse proxy before authorization. Measurements now uses the canonical comparison and rejects missing origins. Nutrition and workouts retain their strict missing-origin rejection; collaboration retains its existing optional-origin behavior. Each wrapper preserves its domain error class and HTTP status.

The 23 explicit application mutation handlers are covered by direct foreign-origin rejection tests in `tests/integration/mutation-origin.test.ts`:

| Wrapper       | Routes and methods                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measurements  | POST `/api/measurements`; PUT, DELETE `/api/measurements/[id]`                                                                                                                   |
| Workouts      | POST `/api/workouts/plans`; PUT, DELETE `/api/workouts/plans/[id]`; POST `/api/workouts/sessions`; PUT, DELETE `/api/workouts/sessions/[id]`; POST `/api/workouts/transformmate` |
| Nutrition     | POST `/api/nutrition/photos`; DELETE `/api/nutrition/photos/[id]`; POST `/api/yazio/connect`, `/api/yazio/disconnect`, `/api/yazio/sync`, `/api/yazio/token`                     |
| Collaboration | POST `/api/comments`; PATCH, DELETE `/api/comments/[id]`; POST, DELETE `/api/trainers`; POST `/api/trainers/invitations`, `/api/trainers/invitations/accept`                     |

The Better Auth catch-all uses the SDK's own configured origin policy and is excluded from this application-wrapper refactor. Regression tests also cover public HTTPS origins with internal HTTP URLs, foreign and missing origins, and spoofed forwarding headers. Real-auth measurements E2E covers owner CRUD, trainer read-only UI and denied writes, foreign owner scope, and retained drafts on access errors.
