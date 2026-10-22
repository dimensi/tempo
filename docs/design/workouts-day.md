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

## Mobile workout and shared date navigation

Verification tier: Full (shared navigation in diary, workouts and reports). Keep the desktop navigation composition, replacing only its date-jump form with a localized Mantine calendar. Phones use the selected date, a compact calendar trigger, Today when needed, and a seven-day ribbon. Horizontal swipes browse weeks without selecting a day; PageUp/PageDown on the day ribbon provides keyboard week navigation. Existing diary links, pending state and report period semantics remain intact. iOS uses a directly tappable native date input; other phones use a Mantine bottom drawer. Native iOS presentation requires verification on an actual device.

Exercise titles and the technique hint form a single target without an ordinal column or separate play icon. Rare exercise actions open a bottom drawer on phones and retain desktop menus. Frequent set actions remain visible; the last-set guard, 800ms autosave and status-only reopening semantics stay unchanged. Download completion is a compact status rather than a disabled button. Add/remove/consolidate test cases: 0/0/0; update the existing smoke to assert download status semantics.

## Mobile feedback refinement

Full verification tier: shared date navigation, new content-fit Mantine bottom sheet and dnd-kit React dependency. Mobile weeks keep unselected days unfilled and highlight only the selected number; Today and the native/calendar trigger are separate controls. Desktop navigation geometry remains unchanged. Bottom sheets constrain height to their content and 85dvh, with native scrolling and reduced-motion support.

Workout status uses a green check and a quiet Cancel action. The persistent autosave tutorial is removed. The workout note precedes exercises, plan metrics occupy a separate toned summary, and set fields and frequent actions share one row. Add set spans the exercise width. The last-set trash control is hidden while the existing deletion safeguard remains. Rare exercise and header actions use bottom sheets, with selective technique/delete icons. Reordering starts from the header menu and shows a compact handle list; touch, pointer and keyboard drops update only the active plan/result ordering using existing save semantics. Canceling a drag leaves data intact. Read-only trainer results remain read-only; reorder mode uses the editable plan instead. Add/remove/consolidate test cases: 0/0/0; the existing smoke now expects the last-set trash control to be absent.

Follow-up visual feedback: the completed label stays semantic green, while Cancel is a neutral outlined button. Mobile day controls have no visible resting borders; the entire day has a rounded hover/press surface; plan metrics use the full summary width. The reorder view has no permanent instructions and its Done button cannot shrink. The smoke scopes its Plan selector to the view switch and waits for plan acknowledgement and refresh completion before testing navigation with an incomplete result draft. No additional test cases.

## Continuous exercise discovery

The exercise picker and standalone catalogue append the next page automatically as the end of the loaded cards approaches the scroll viewport. Earlier cards and selected exercises remain available; changing search or muscle filters starts a new result list while retaining selection. The footer shows loading, a retry action after a failed page request, or the unique loaded count and the catalogue total when known. Failed requests preserve the cards already loaded. The sticky add-selected action remains separate from loading progress.

This bounded interaction refinement preserves the existing card grid, inline playback, Mantine teal controls and shared read cache. It introduces no visual-system tokens, storage contracts or additional navigation.

Verification tier: Isolated, because only the workout catalogue presentation changes. Prettier, scoped ESLint, typecheck, the existing unit suite (3 cases), production build and existing browser smoke (1 case) passed. Add/remove/consolidate cases: 0/0/0. Manual browser checks with synthetic catalogue responses confirmed 12 → 24 → 30 appended cards, retained selection, retry after a failed page request and search reset. Finish review: ship, with no requested fixes, against desktop, 662px and 390px captures in `.impeccable/review/`.

## Mobile-first recording refinement (22 October 2026)

The existing day workspace and Mantine/teal identity remain authoritative. Instead of adding a second hierarchy of training pages, the empty day now reveals two distinct owner actions: **«Составить план»** and **«Записать тренировку»**. Trainers see only planning. A result created without a plan is still saved as a real session; its title is editable and its sets are entered with the usual durable queue. New exercises can be appended directly to either an existing or an independent result, initialized with missing values rather than copying planned repetitions.

### Phone first

- At 320–767 px, the shared date ribbon sits on a quiet neutral surface, the plan/result control owns one full row, and a slim entered/total set summary appears only when there are sets. It is not a gamified score: a set counts as entered only with positive repetitions. Saving remains automatic for results and manual for plans.
- Each exercise has one full-width technique/name target, a brief entered-set count, a compact reference row for planned weight × repetitions, then the actual numeric inputs. Headings shorten to «кг» and «повт.» at phone widths, while accessible input names stay fully descriptive. Frequent set actions stay immediately beside inputs, 44 px or larger. The reference row wraps rather than scrolling horizontally.
- The final action inside the exercise adds a new set. Adding an exercise is a separate explicit action at the end of the editable result or plan. The existing full-screen phone picker, media dialog, comment flow and confirmation remain unchanged. A saved exercise cannot be removed without a network connection; the control names why. New, unsaved exercise occurrences remain removable.
- On an empty day, the two primary tasks appear as clear choices, followed by optional TransformMate refresh. Loading, provider errors, offline queues and download progress remain inline and never masquerade as the session's success state.

### Desktop from the same model

At 768 px and wider, the exact same task/order is retained, not a separate dashboard. The page stays within the established 860 px workspace, plan/reference groups use horizontal room and number fields remain bounded for rapid keyboard entry. The mode/status toolbar sits on one row; date selection uses the existing desktop calendar. Exercise targets, media, set actions, permission checks and data models are shared. There is no alternative client-side router or duplicate editor state.

### Data integrity and edge cases

Recorded sessions render their frozen `planSnapshot` as the comparison reference, even when the source plan has since changed. An unlinked result is not shown a fictional plan. An offline queued independent result keeps its editor and pending draft visible, preventing an empty-day flash. Cancel is hidden once a queued create exists; logout continues to clear account-scoped reads, drafts and downloads under the existing flows. A saved exercise with possible personal-video attachments cannot be removed offline. These are UX guards; backend revisions, authorization, video locking and queue idempotency stay authoritative.

**Verification:** source changes are provided as a reviewable branch. Full browser captures, `pnpm verify:merge`, and real-iOS/desktop visual checks still require a runnable authenticated Tempo environment; no successful runtime verification is claimed here.
