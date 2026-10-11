# ADR 001: single application foundation

Status: accepted for initial foundation. Date: 2026-10-11.

Use one Next.js App Router application with Mantine and server-only Drizzle/SQLite. Independent feature folders plus shared normalized contracts provide parallel ownership without packages, repositories, queues or services created for hypothetical growth.

Verified npm peer metadata:

- Next 16.4.0 supports React 19; React/React DOM 19.3.0 match.
- Mantine packages 9.7.2 require React/DOM ^19.2.0 and matching core/hooks.
- Mantine charts requires Recharts >=3.2.1; use 3.10.1.
- Mantine schedule requires matching dates/core/hooks 9.7.2.
- Better Auth 1.7.7 supports Next 16, React 19, Drizzle ^0.45.2 and Drizzle Kit >=0.31.4.
- TypeScript 7 conflicts with typescript-eslint's <6.1 peer constraint; use 6.0.3.
- ESLint 10 conflicts with React/import/a11y plugin peer ranges in Next config; use compatible ESLint 9.39.5. npm marks this release unsupported, so upgrade once the plugin ecosystem supports ESLint 10.

Frozen lockfile, strict-peer-dependencies and CI make installation repeatable. Required charts/dates/schedule packages are available to future agents, but no product charts or schedules are implemented.

Standard Better Auth password hashing/session machinery is used, with closed registration and local transactional user creation. Trainer permissions and explicit owner grant are centralized. Tokens use a server secret-store seam rather than inventing encryption. DB uses WAL, one process and short transactions. Native SQLite is compiled in the Docker dependency stage; Chromium is absent from production.

Official setup references: https://mantine.dev/guides/next/ ; https://better-auth.com/docs/adapters/drizzle ; https://better-auth.com/docs/authentication/email-password .
