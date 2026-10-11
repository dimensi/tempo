# Architecture overview

One Next.js application, Node runtime. Server Components compose routes; client components provide Mantine context, navigation, login and theme interaction. A protected dashboard layout requires a real Better Auth session. Route handlers independently enforce permissions.

`src/features` owns product behavior. No feature imports another feature; shared transport-neutral types are in `src/contracts/v1.ts`. Business logic belongs in small server modules or feature modules, not large page components. SQLite is accessed only on the server. There is no separate backend, queue or scheduler.

Shared shell/theme/messages, contracts, authentication, schema, migrations and deployment are core ownership. Coordinate those edits before parallel work. `server-only` protects server entry points at build time; lint catches common boundary violations.

Current tables are Better Auth user/session/account/verification plus an explicit trainer grant. No nutrition schema exists yet. DB connection is lazy to avoid needing credentials or SQLite at build time. One process, WAL, 5s busy timeout and short transactions support a future background sync without adding infrastructure.

Mantine is the only UI system. Required Mantine packages are installed, but product chart/calendar/report functionality is deferred. Playwright browsers are development/CI dependencies only. Uploaded files will be private persistent storage; there is no public serving endpoint.
