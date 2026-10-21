# Сверка результатов с оригиналом

Mode: Operate. Local extension of the existing Mantine/Arial/teal system; no visual-world change.

## User contract

A dedicated `/anamnesis/documents/[documentId]/review` route, reached from the document list and the original viewer. On desktop, the editable form is LEFT and the authenticated original PDF is RIGHT. One selected result replaces the former inline stack of review cards. The existing server authorization, revisions, correction and rejection semantics stay in force.

## First viewport

The document identity and remaining count introduce the workspace. A searchable queue leads to one result, its review reason and source quotation, then the marker/value/unit/date fields. The original is visible beside the form on its source page. Users can browse neighbouring PDF pages for missing dates without replacing the selected result or draft. Confirm advances through the queue; reject is secondary.

## Adaptation and states

Use the generic wide-content opt-in only on this route. From 75em viewport width, retain a form/original split with independent form scrolling and a visible document. Below that width, use Form/Original segments; both panes remain mounted, preserving draft and page state. Native PDF navigation/zoom remains available, with a real open-PDF fallback link. Small controls remain at least 44px, long Russian labels wrap, and columns shrink without horizontal page overflow.

Drafts use the existing account-scoped bounded view-state storage, at most 32 edited reviews per document. Preserve input on request failures and on switching results or panes. A changed server revision requires explicit reload before confirmation. Offline cached fields remain readable; saving/rejection explain their network requirement at the affected controls. Empty, loading, read-error, conflict and unsupported-PDF states retain the same workspace and a clear next action.

## Verification

Use a synthetic laboratory PDF and real local authentication. Capture desktop and mobile together, exercise selection, field editing, PDF page navigation, draft retention, confirm-next and rejection, and inspect light/dark themes. Bound visual corrections to the independent reviewer’s two correction rounds. Existing compact Full verification remains mandatory; add no new maintained test cases for this layout task.

## Completion comparison

The dedicated review surface extends the incumbent system documented in `DESIGN.md`: Mantine fields, buttons and bordered Paper containers; inherited Arial typography; teal primary and selected states; semantic body, border and dimmed colors; and the shared PageHeader. The result heading is subordinate to the page heading. Red remains the existing rejection/error status color. No new font, palette, UI kit, global token, shadow vocabulary or visual identity is introduced. The wide form/original composition and 75em split belong to this surface only.

Implementation evidence: `src/features/anamnesis/review-editor.tsx`, its CSS module and the dedicated route. The form uses the existing read resources and account-scoped view-state layer. Mobile switches visibility without unmounting the panes. The PDF iframe requests the selected source page with `#page=N&zoom=page-width&navpanes=0`; neighbouring-page controls and an authenticated open-PDF link remain available. The original pane is measured with `useElementSize`; its rounded width participates in the iframe key so resizing or revealing the mobile pane remounts the viewer and reapplies page-width fitting. The desktop form scrolls independently with its actions at the bottom of the pane.

Visual evidence from the final local synthetic-document captures:

- `desktop-final.png`: form left, original right; the source link, application page selector and native PDF viewer agree on page 3 of 3. The original is readable without a thumbnail sidebar.
- `desktop-dark-final.png`: the same composition retains the incumbent dark surfaces and teal action hierarchy. The original document keeps its own white paper.
- `mobile-form-final.png`: wrapped identity and result name, Form/Original segments, a single-column date/precision group and wrapped actions remain within the viewport.
- `mobile-original-final.png`: page 3 and the fallback link are visible. After width-aware remounting, the paper fits within the embedded viewport and all marker, result and unit columns are visible at the smaller scale. The task reported a 390px viewport with a 375px document scroll width and no horizontal page overflow. This local Chromium capture does not establish native-device or Safari PDF behavior; native zoom and the open-PDF fallback remain available for reading small text.

These are local Chromium captures with a synthetic three-page laboratory PDF, not production medical data. Their task-local source directory is `/private/tmp/tempo-review-shots`; they are evidence for this review, not durable project assets.

## Functional evidence and remaining gates

The task's manual validation used real local authentication and synthetic data. Reported outcomes: confirmation returned 200 and rejection returned 204, both advancing the queue; drafts survived switching results, switching panes and reloading; disconnected fields stayed readable while write controls were disabled; a revision conflict returned 409, retained the draft and blocked confirmation until explicit reload; a wrong-owner catalog request returned 403. The finish-documentation pass inspected source and captures and did not repeat those interactions, run the app, or run tests.

The first visual review required the source to open page 3 and the desktop original to be readable without a thumbnail sidebar. The final desktop captures demonstrate those two corrections. The second verdict scored source-page synchronization and responsive document clipping resolved, with a ship disposition limited to those fixes. The repository’s Full verification remains mandatory before merge; the captures and manual checks do not replace it. No maintained test cases were added, removed or consolidated by this documentation pass.

`DESIGN.md` and `.impeccable/design.json` are preserved. The existing sidecar predates this work and does not reflect all current global documentation (including the edge-to-edge viewport guidance); this pre-existing documentation drift is reported rather than repaired. This ordinary extension does not require a design-system refresh or a new design interview.
