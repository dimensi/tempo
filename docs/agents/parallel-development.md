# Parallel development

One agent = one feature branch = one worktree. These examples describe future independent work; they do not assign active tasks.

```sh
git fetch origin
git worktree add ../nutrition-diary -b feat/nutrition-diary origin/main
cd ../nutrition-diary
pnpm install --frozen-lockfile
cp .env.example .env
# Set a unique secret, DATABASE_URL=file:./.data/development.sqlite
# Set BETTER_AUTH_URL=http://localhost:3001
pnpm db:migrate
# Create a local owner with auth:create-user
pnpm dev --port 3001
```

A relative `.data` database gives each checkout its own SQLite file. Assign each simultaneous dev server a distinct port and matching BETTER_AUTH_URL. Use independent secrets. Never copy production credentials/data into worktrees. Each worktree has independent ignored `.env`, `.data`, `.next`, and E2E DB. E2E defaults to port 3100; run shared smoke checks serially when several worktrees use the same machine.

Before writing code: read AGENTS.md; record owned paths, contract version and acceptance checks using the task template. Agree shared contract changes first. Then independent examples are A YAZIO integration; B nutrition diary; C measurements/workouts; D analytics; E reports; F comments. Ownership mapping is in feature-boundaries.md.

Use `getDemoFixtures()` on the server with DEMO_MODE=true for local previews. Fixtures are marked demo; never insert them into real user tables or ship them on production pages. Keep placeholders until a feature has real behavior.

Shared/core edits must be proposed as a separate coordinated change. Do not have multiple agents generating DB snapshots simultaneously; merge/rebase the agreed schema change before regenerating a feature migration. Rebase on current main before final checks. Open a narrow PR with behavior, tests actually run, contracts, data scope, migration impact and limitations. No automatic main commits or merges.
