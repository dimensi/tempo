# Unified read resources and medical offline reading

User-authorized scope: core client read resources, read-cache contracts/storage/SW, stable dashboard lifetime, shared reading/navigation adapters, medical safe projections and existing read UI, targeted unit tests and architecture documentation. No new product writes, migrations, dependencies, auth configuration, CI, publication or deployment. Based on main 67340d0; one existing managed worktree, branch codex/unified-offline-reading.

Resource record version 1 in read IndexedDB version 3, separate from the existing write queue. Preserve OWNER write partition. Medical detail: 15 days since view, at most 100 resource records and 10 MiB; summaries are separately bounded. Existing server authorization and granular marker/document grants are authoritative.

Acceptance: no automatic document reload or HTML reachability probe; live form tree survives connectivity changes; cold read uses common views and the same resource cache; local resource errors do not erase existing data; denied scope clears cached data; medical summary warmup excludes file bytes and source credentials. Tests: focused unit selection, typecheck, lint only. Manual cold-launch/reconnect/PWA checklist; no automated browser checks.
