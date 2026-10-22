# Workout workspace

Verification tier: Full. This task adds no test cases; the coordinator verifies the merged contracts, server, queue and UI with the existing compact suite.

`/workouts?date=YYYY-MM-DD` presents one local workout through three states: `planned`, `in_progress`, `completed`. Creating starts a planned workout. Starting preserves its title, note, occurrences and entered sets. Completing locks fields and editing controls; the owner can resume with all values retained. Trainers create and edit planned workouts and read granted active/completed workouts, but never execute transitions. Provider/native workouts remain read only, including unsupported metrics.

Title, note, exercises and sets share one form. Both editable states autosave after 1200 ms. Owner writes use the durable shared queue; trainer writes use the canonical workout API. Late acknowledgements update revision bookkeeping without replacing newer inputs, focus or scroll. Partial numeric text stays in session storage and blocks saving/transition with an inline error. Start and complete require an exercise and valid sets for every exercise. Empty planned workouts can be stored.

Saved occurrence removal requires the online confirmation path so the server can clean private videos. Unsynced writes must settle first. Technique, personal video and comments remain readable for completed workouts. Keyboard activation of Add set focuses the new weight input immediately. Copying to another date produces a planned workout with fresh occurrence IDs. The existing download capability remains hidden.

Draft storage is partitioned by reader and owner. Legacy plan/result envelopes are converted once into a review-required canonical draft; the original envelope and conflicting plan alternative remain stored until the user explicitly chooses a version. Review never silently overwrites a newer server base. Stable record IDs prevent a restored pending creation from producing another workout.
