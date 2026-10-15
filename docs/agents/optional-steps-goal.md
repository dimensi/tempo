# Optional steps goal

Scope: reports, settings composition/UI, owner settings persistence and migration, permission/settings contract, focused tests. Approved nullable contract: `{ dailyStepsGoal: number | null }`; missing row means no goal. Current goal applies to newly generated reports for all dates. No overview/analytics edits or historical goals.

Acceptance: settings save/disable survives reload; owner-only writes; scoped trainer report reads; real PDF values/goal/unknowns; compact A4 and mobile geometry; migration fresh/existing; all three complete E2E suites before merge.

Settings use `GET/PUT /api/settings/steps-goal` with `{ dailyStepsGoal: number | null }`. The owner is resolved from the authenticated session; `settings:manage` is owner-only and writes require trusted Origin. Values are positive safe integers or null; null disables the goal. No automatic goal is persisted. The UI proposes 10,000 only in an unsaved enabled form. Migration 0012 adds `owner_settings` with a user foreign key and a nullable integer CHECK.
