# Workouts

`/workouts?date=YYYY-MM-DD` is the single workout workspace. It combines the selected plan and its latest local result; additional real sessions and provider records on a date remain available through a selector. The old create/detail/result routes were removed.

The page owns the date ribbon; the application header owns the section title and actions. Exercise catalogue is a navigation child. Provider reads use the shared read store. Refreshing upstream is an explicit action; successful exchange details are shown in a dialog, never as a blinking permanent status panel.

Creation and plan editing use a multi-select exercise picker with a manual option. One selected workout is edited while preserving all other workouts and the plan period. Copying creates fresh planned identities and no actual results. Plans still use the authorized existing publication service.

Execution uses the same exercise/set layout. Actual repetitions start empty; only entered sets become results. Clicking the explicit check control copies a planned set into the actual result. Weight missingness stays null. Valid results save after input settles through the durable owner write queue, retaining revision and account checks. Adding an occurrence to an offline result is allowed; removing an existing occurrence remains blocked to protect attached videos. Changes that remove recorded occurrences require explicit confirmation because attached personal videos are deleted too; they use the existing online session API and retain the draft on failure.

Plan and actual records remain separate persisted contracts. Historical snapshots never change with plan edits. Trainers may edit plans and read granted results; only the owner records results. Native/provider results remain read only and preserve unsupported metrics.

Names open a focused media drawer: technique first, personal performance videos on a second tab. Players mount only on request and dispose on close. Private-video ownership, upload resumption and server authorization remain mandatory. Comments are composed once at the route layer for the selected actual session; feature modules never import one another.

Drafts have stable actor/owner/resource/day identities and carry both acknowledged plan and session revisions; stale bases are shown as conflicts before any write. They are bounded to eight entries, 256000 characters and twelve hours using the existing draft storage. Session reset clears drafts. Failed saves preserve input. Device writes are not removed by read-cache reset.

Verification: Full, including the existing authenticated browser smoke updated to create a plan, enter a result and restore cached day data. The existing write-repository integration case also checks progressive addition of an exercise and rejection of occurrence removal. No new test cases.
