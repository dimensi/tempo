# TransformMate persistent catalog task

- Objective: durable server copy of the whole exercise catalog, original images,
  highest-quality MP4 and generated JPEG posters, available through provider outages
  and disconnects to the owner and explicitly permitted trainer.
- Worktree: `transformmate-enrichment/yazio-dashboard`; branch:
  `codex/transformmate-enrichment`. Only synthetic local databases/credentials.
- Owned paths: TransformMate server/catalog/media, its DB schema and new migration,
  instrumentation, replica v1 contract/status API and settings subsection, focused
  integration scenarios and existing disposable Docker smoke. Shared/core changes
  are explicitly authorized by the accepted implementation plan.
- Verification tier: **Full**, because persistence/schema, contracts, server lifecycle
  and Docker change. Require `pnpm verify:merge` on the clean final commit, Docker
  image build and `scripts/docker-smoke.sh` on disposable volumes.
- Tests: zero added/removed/consolidated cases. Extend the existing migration,
  TransformMate recovery and authorization cases. Keep genuine browser authentication.
- No production data or credentials, no merge/deploy authorization. Prepare a PR.

## Settings presentation refinement

The owner requested readable database progress and media metrics. Keep the existing
status API and worker behavior, show independent catalog coverage, bytes, queue and
errors; collapse connection controls and diagnostics. Verify desktop and 390px
synthetic states. Zero new test cases. The PR retains Full verification because
its schema/contracts/lifecycle changes remain part of the final revision.
