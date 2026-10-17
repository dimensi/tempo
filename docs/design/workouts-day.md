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

Provider refresh is explicit; its status and details live in a dialog rather than permanent provider panels above exercises. Successful background exchange remains quiet. The exercise picker opens as a full-screen task on phones and a wide dialog on desktop. Video-led cards expose playback in place, with visible body categories, a muscle filter and multi-selection. Selected exercises are added together. Technique and «Мои видео» share a focused dialog; the description stays openly visible below the technique video. One «Скачать тренировку» action saves the loaded data, exercise details and all available technique videos for the gym, with progress and an explicit partial-failure state. Saved videos play from the device even while online.

The new play overlays, selected category and exercise buttons, and add-selected action use Mantine teal 9 with white text in both themes; hover mixes black at 15%. This scoped contrast adjustment keeps the incumbent palette and primary theme settings. Selection remains explicit through pressed states, labels and the exercise check icon.

Download progress names the current exercise and completed/total video count after data preparation. Completion shows the saved video count; missing source videos are named separately. A failed attempt keeps completed files and the action available for retry. Unsaved day edits must be saved before download. This retains an already loaded workout through the existing account-scoped stores; it does not introduce another router or a cold offline shell.

The shared header pattern applies across top-level pages. Exercise discovery is part of adding exercises; the catalogue no longer occupies daily navigation. The existing catalogue route uses the same cards and filters. Former new/detail/result page routes do not remain as compatibility paths. Existing authorization, trainer grants, result missingness, provider write restrictions and stored user data remain unchanged by this visual structure.

Drafts are scoped by actor, owner, resource and day, with acknowledged plan and result revisions tracked separately. Saving a plan preserves incomplete result input. Edits made during a pending result write are coalesced into a later save. Automatic saves never silently remove recorded exercise occurrences or their private-video references; an explicit removal confirmation precedes the existing destructive online operation.

The owner opens pending workout writes from the day menu's «Записи на устройстве» item. The existing queue and conflict-resolution controls appear in a modal instead of above the exercise workspace. The app page supplies this block through `renderPendingWrites`; queue storage, synchronization and resolution behavior remain unchanged.

## Boundaries and verification

Own workout UI/routes, the shared header/navigation integration, Russian messages, design documentation and affected existing smoke assertions. Preserve schemas, permissions, migration history and provider write rules. No automatic production writes while testing the locally imported account.

Verification tier: Full, because shared navigation and workout write interaction change. Run `pnpm verify:merge` on the final clean committed revision. New tests: default zero; adapt existing cases. Inspect desktop, mobile and the user's 1015px width in one batch, fix together, then confirm once. Finish reviewer and documenter receive the same direction and evidence.
