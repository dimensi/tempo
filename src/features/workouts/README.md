# Workouts

`/workouts?date=YYYY-MM-DD` is the single daily workspace. Each local workout is one persisted record with one title, note and ordered exercise/set list. Multiple real workouts on the same date remain separate entries.

The lifecycle is `planned → in_progress → completed`, with `completed → in_progress` through Continue. Create always starts planned. Start preserves all entered values; Complete confirms the remaining sets as results. Resume preserves the result and unlocks editing. There are no plan/result tabs, original-plan comparison fields, per-set completion checks or entered-set progress counter.

Owners can edit planned and in-progress workouts. Granted trainers can create and edit planned workouts; execution transitions and results remain owner-only. Completed values are readonly until Resume. These rules are checked on the server, including revisions and idempotent command retries.

Both editable states auto-save after a 1200ms pause. Background saves do not disable inputs, remount the editor or replace newer input. Partial numeric text stays in a bounded account-scoped draft across navigation; invalid fields prevent transitions and show inline feedback. Creating an empty plan is allowed; Start and Complete require exercises with valid sets. Queued owner writes preserve their order, partition, revision and stable operation identities. Ambiguously delivered pre-migration operations remain reviewable rather than being silently resent with changed fingerprints.

Exercise discovery keeps the existing full-screen phone picker and desktop dialog, manual entry, muscle filters, multi-selection and inline technique playback. Keyboard activation of Add set focuses the new weight field. Copying to another day creates a planned workout with fresh workout/exercise identities. Removing saved exercise occurrences remains an explicit online action with existing personal-video cleanup and confirmation.

Technique, personal videos and route-composed comments remain available when completed. Provider/native workouts remain readonly and retain unsupported metrics. TransformMate publication snapshots are transport reconciliation data, not a second local workout model; execution edits never republish a plan. The download control remains hidden while its cache/video implementation is retained.

The migration preserves session and exercise identities, personal videos, comments, every historical result, parent text and empty actual occurrences. Old nested plan IDs are retained when unique and remapped when necessary; immutable identity metadata supports restoration of old drafts. Original numeric plan snapshots are removed from local workout records. Existing read-cache bodies must validate against the new version-2 contract; cache replacement does not clear pending writes.

Verification tier: Full. Existing unit, integration and browser smoke scenarios cover migration/data integrity, lifecycle guards, real authorization, durable writes and editing continuity. No new test cases; actual executed checks and final SHA are recorded in the task report.
