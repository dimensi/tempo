# TransformMate stage-specific failures

- Objective: distinguish original-image, video, poster and metadata failures in the
  owner settings without treating a missing upstream image as failed video.
- Owned paths: replica contracts/store/gate/worker/media/status, catalog pending
  state, replica DB schema + generated migration, status UI and its stylesheet,
  existing migration/recovery integration scenarios and replica documentation.
- Tier: Full (persistent queue migration and shared status contract). Require
  `pnpm verify:merge` on a clean committed revision, image build and disposable
  Docker smoke. New/removed/consolidated test cases: 0/0/0.
- Preserve object references, existing retry dates, account scopes and grants.
  Store HTTP status only when observed. Old ambiguous failures remain job-level.
- Do not change production queue/configuration, merge or deploy without the
  corresponding user instruction. Monitoring of the current load continues.
