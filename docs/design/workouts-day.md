# Единый экран тренировки дня

Mode: Operate. Build: code-first, confirmed by the owner.

## Direction

Extend the existing Mantine application identity: its teal accent, system font, light/dark themes and quiet surfaces. The approved interaction structure replaces the workout list → detail → editor journey with a dated workspace; this is not a visual rebrand.

## Direction contract

**THESIS:** The selected day is the workout workspace. Exercises and set entry replace the former list → detail → editor journey; former new/detail/result page routes are removed.

**OWN-WORLD:** Extend the incumbent Mantine teal/Arial application with theme-aware neutral surfaces, rounded controls, thin dividers and 44px touch targets. Preserve its identity and product semantics.

**STORY:** Understand today's plan, check technique beside an exercise, record actual sets and return to the same day. Plan and result share a visual grammar while preserving separate stored records.

**FIRST VIEWPORT:** One shared header contains the section heading and compact refresh/menu/save actions. The date ribbon precedes a centered exercise sequence (maximum 860px). Wrapping exercise names and numeric set rows take priority over descriptions, provider metadata and media.

**FORM:** Code-led extension of the approved existing application. No composition-ranking workshop or random seed was used for this incumbent extension; no seed key is claimed. Signature: opening technique from an exercise name preserves entered sets. A focused video dialog uses a short transition, or zero with reduced motion.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## First viewport

The shared app header identifies the current section and carries page actions. Below it, the day ribbon leads directly to exercises. Each exercise has a clickable, wrapping name and compact numeric set rows. No duplicated plan/session headings, technical provenance badges or expanded media sections precede the task.

## Signature interaction

Tap an exercise name to open its technique video in a focused dialog without leaving or losing entered sets. Switch to personal videos in the same dialog. The dialog returns focus to the exercise on close. Keep its transition short and respect reduced motion. While choosing exercises, play technique inside a video card and select several exercises before adding them together; no details sidebar interrupts selection.

## Flow

An empty day offers creation and an explicit provider refresh. Creation starts with multi-selection in a searchable exercise picker, with secondary muscle filters and an explicit manual option. Plan editing and result entry use the same exercise/set visual grammar. Results preserve missingness, revision conflicts, account separation and the durable owner write queue. One session owns one comment thread. Multiple real records on a date remain accessible through a compact selector.

Provider refresh is an explicit menu action. Its requested progress or result appears as a short inline message; it opens no status dialog. Successful background exchange remains quiet. The exercise picker opens as a full-screen task on phones and a wide dialog on desktop. Video-led cards expose playback in place, with visible body categories, a muscle filter and multi-selection. Selected exercises are added together. Technique and «Мои видео» share a focused dialog; the description stays openly visible below the technique video. One «Скачать тренировку» action saves the loaded data, exercise details and all available technique videos for the gym, with progress and an explicit partial-failure state. Saved videos play from the device even while online.

The new play overlays, selected category and exercise buttons, and add-selected action use Mantine teal 9 with white text in both themes; hover mixes black at 15%. This scoped contrast adjustment keeps the incumbent palette and primary theme settings. Selection remains explicit through pressed states, labels and the exercise check icon.

Download progress names the current exercise and completed/total video count after data preparation. Completion shows the saved video count; missing source videos are named separately. A failed attempt keeps completed files and the action available for retry. Unsaved day edits must be saved before download. This retains an already loaded workout through the existing account-scoped stores; it does not introduce another router or a cold offline shell.

The shared header pattern applies across top-level pages. Exercise discovery is part of adding exercises; the catalogue no longer occupies daily navigation. The existing catalogue route uses the same cards and filters. Former new/detail/result page routes do not remain as compatibility paths. Existing authorization, trainer grants, result missingness, provider write restrictions and stored user data remain unchanged by this visual structure.

Drafts are scoped by actor, owner, resource and day, with acknowledged plan and result revisions tracked separately. Saving a plan preserves incomplete result input. Edits made during a pending result write are coalesced into a later save. Automatic saves never silently remove recorded exercise occurrences or their private-video references; an explicit removal confirmation precedes the existing destructive online operation.

Pending workout writes have no menu entry or modal. The app page composes `OfflineWrites pendingOnly` inline through `renderPendingWrites`; it renders only for a genuine offline wait, retry or review requirement, with plain explanatory copy and existing resolution controls. A normal first sending attempt stays quiet. Queue storage, sending, authorization and resolution behavior remain unchanged.

## Boundaries and verification

Own workout UI/routes, the shared header/navigation integration, Russian messages, design documentation and affected existing smoke assertions. Preserve schemas, permissions, migration history and provider write rules. No automatic production writes while testing the locally imported account.

Verification tier: Full, because shared navigation and workout write interaction change. Run `pnpm verify:merge` on the final clean committed revision. New tests: default zero; adapt existing cases. Inspect desktop, mobile and the user's 1015px width in one batch, fix together, then confirm once. Finish reviewer and documenter receive the same direction and evidence.

## Explicit actions and open fields

Keep plan and execution as separate views. Plan title and description are always visible in plan mode; no native details/summary disclosure is used in workout UI. The primary header action has a visible verb (Save or Finish). Completed status sits beside an explicit Cancel completion action; no play/pause metaphor is used for workout status. Set actions stay visible beside each row: «По плану» and a Tabler trash icon to remove a set, each with a minimum height of 44px. On phones they sit directly below the numeric fields, preserving space for input; on desktop they share the input row. No dropdown is needed for these frequent actions. A filled set has no interactive success check mark. Actual set entry states that saving is automatic and planned sets name repetitions and weight explicitly.

Cancel completion changes only status against the latest durable queued or acknowledged session, using its matching revision as the write base. It never submits unsaved exercise edits or clears their dirty state. Entered fields stay in place, and the removal safeguard remains exclusive to result editing. The existing smoke covers reopening with a cleared exercise draft while asserting preserved exercises, note and plan snapshot on the server.

This refinement is Full tier because it touches workout interaction, route composition and the offline feature presentation. Add/remove/consolidate cases: 0/0/0; extend the existing smoke to cover open plan fields and direct set actions.

## Direct set actions refinement

Verification tier: Full, because preserving a saved actual occurrence without sets touches the shared workout contract. Planned exercises still require at least one set. Actual rows retain their identity when values are absent, keeping attached video references and existing stored data readable. Set autosave and status-only changes preserve those recorded occurrences; removing an exercise remains a separate protected action.

«По плану» and the Tabler trash icon are visible without a dropdown. There is no separate Clear action. The last remaining set cannot be removed; its disabled trash control has a tooltip and accessible explanation that the whole exercise can be removed through the exercise menu. Actual input auto-saves after an 800ms pause without requiring blur; plan saving remains manual. An existing actual occurrence with an empty set array opens with a blank input row; no repetitions or weight are invented, and no database repair or SQL migration is required. Status-only saves retain every occurrence, including those without sets.

Finish review: SHIP, with no requested fixes, against [desktop](../../.impeccable/review/quick-actions/desktop.jpg), [1015px](../../.impeccable/review/quick-actions/user-1015.jpg) and [mobile](../../.impeccable/review/quick-actions/mobile.jpg) captures. The detector reported only pre-existing font advisories; this refinement changes no typography tokens. Full verification remains pending: run `pnpm verify:merge` on the final clean commit. The existing browser smoke covers direct actions and the last-set guard, and the existing write repository case covers empty actual sets with retained identity. Add/remove/consolidate cases: 0/0/0.
