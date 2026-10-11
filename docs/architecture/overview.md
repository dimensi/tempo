# Architecture overview

One Next.js App Router application runs on Node. Server Components compose protected pages; client components provide Mantine interaction and theme persistence. Better Auth supplies real sessions. Each data handler separately authorizes permission and owner subject; trainer access requires a current explicit grant. Accessible-owner selection is not authorization. Comments and private-photo handlers recheck grants after asynchronous target/file I/O.

Implemented modules cover the nutrition diary and exact decimal normalization, owner-triggered YAZIO sync, private photos, manual measurements, workout plans and actual sessions, analytics, trainer invitations/grants and comments. Comments reference an existing owner-scoped nutrition day, measurement or actual workout session. Trainer planning does not permit actual-result logging. PDF product reports are merged in main and composed by the reports page; deployed availability is a separate release check.

`src/features` owns product behavior, with versioned transport-neutral contracts in `src/contracts`. Features do not import other features. Server composition uses public domain APIs and maps upstream structures to contracts. Core owns shell/messages, auth, schema/migrations and deployment. Boundary checks and `server-only` protect those seams; schema/connection and CLI-compatible modules retain documented exceptions.

SQLite stores auth users/sessions/accounts/verification, trainer grants/invitations, comments, measurements, workout plans/sessions, nutrition snapshots, reference cache, sync status and photo metadata. Drizzle discovers `schema.ts` and `schema/*.ts` without cyclic user reexports. Committed SQL/metadata apply at startup. Lazy connections avoid build-time DB requirements. One process, WAL, a 5s busy timeout and short transactions are supported; upstream HTTP and file I/O stay outside write transactions.

Sync is explicitly requested, bounded and serialized per owner in the process. There is no durable queue or automatic scheduler. Failed day fetch/normalization preserves the prior snapshot. References are owner-cached. Exact decimal strings distinguish unknown, partial known totals, official totals, deltas and issues instead of inventing missing values.

Mantine is the only UI system; diary, measurements, workouts and analytics use authorized loaders. Uploads remain private, with no public storage-key or upstream-URL DTOs. The production image includes locked Chromium and a Cyrillic-capable font with PDF runtime smoke validation; a main merge does not establish which revision is deployed.

The home preview has its own deployed revision and server-local config. Real authentication and synthetic upstream tests do not establish live YAZIO sync while the token remains unset. See [deployment](../deployment.md) and [YAZIO integration](yazio.md).
