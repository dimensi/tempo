# YAZIO daily goals and overview

- Objective: persist dated base calorie and steps goals from YAZIO; show actual, goal and difference without treating missing as zero or fewer calories as better.
- Scope: daily goal storage/sync, read-only settings, overview-triggered hourly sync, diary/analytics/report/MCP consumers, neutral measurement charts. No merge/deployment or unattended history imports.
- Branch/worktree: `codex/yazio-goals-overview`, `/Users/n.nafranets/.codex/worktrees/yazio-goals-overview/yazio-dashboard`; local databases only. Base `d221daa`.
- Ownership: all task changes, including coordinated schema, contracts, shared reads, dictionaries and routes.
- Contracts: v1 dated goals keyed owner/date, nullable positive calorie/steps goals and fetchedAt. Base calories come from `/user/goals/unmodified?date=...`.
- Authorization: owner alone triggers POST sync; trainer reads with existing grants; MCP reads never synchronize. All persistence is lease/epoch fenced.
- Cache: ADR 002; retain saved data on failures, refresh affected loaded reads after sync, preserve account generation and pending writes.
- Sync acceptance: one durable automatic attempt/hour across tabs/devices/restarts including failures; today/yesterday only; successful manual sync covering both counts as fresh. No periodic YAZIO read polling or hourly page timer; mounted/visible overview triggers only. Running work survives navigation.
- Goals acceptance: manual/initial range imports fetch history; no invented historical goals; failures preserve prior values and do not cancel food/steps. Manual steps setting remains stored but unused.
- Presentation: adjacent today nutrition/steps, diary selected-date goals, dated analytics reference series with gaps, paired-day assessments excluding today, historical report goals, one neutral measurement series retaining distinct same-day points and linked-record deduplication.
- Synthetic fixtures only; no production credentials/data copied.
- Schema: generated new migration and metadata; verify fresh/existing databases without modifying deployed SQL.
- Verification tier: Full (schema, shared contracts/cache, multiple features). Root runs `pnpm verify:merge` on clean final commit after independent Standards/Spec review.
- Tests: zero new cases; extend existing nutrition-sync/migrations coverage for goals, retention, cooldown/race and stored legacy value. Narrow checks during implementation; desktop/mobile visual validation in bounded passes.
