# Readable marker history

Mode: Operate. This is a local refinement of the incumbent Mantine/Arial/teal system described in [DESIGN.md](../../DESIGN.md), within the product commitments in [PRODUCT.md](../../PRODUCT.md). It introduces no new visual identity or global tokens.

## Local pattern

The marker history uses one semantic list inside the existing bordered Paper. Quiet theme-aware separators distinguish rows. Each row retains the complete marker name, latest value and unit, collection date, measurement count and reference assessment. Existing missing-data text and text-bearing status badges keep missing values and assessments explicit. Search and detail links retain their existing behavior. Values, date formatting, calculations, authorization and read-cache behavior are outside this presentation change.

The list fits the anamnesis content region beside its section navigation, without the former five-column table's minimum width. A container query at 32rem places name and result in two shrinkable columns; below that width they stack in the same DOM order. Metadata wraps beneath them. Long names, units and qualitative results wrap without truncation. Numeric values, dates and counts use tabular figures.

Marker names remain underlined before interaction and in the visited state, using the current theme's normal foreground. Hover uses Mantine's anchor color; keyboard focus has an explicit theme-aware outline. Each name link has a minimum height of 44px. Unit, date and count text use the normal foreground for readable contrast; smaller type supplies their supporting hierarchy. Status meaning remains in its label as well as its existing badge color.

Implementation: [marker list](../../src/features/anamnesis/marker-table.tsx) and [local styles](../../src/features/anamnesis/marker-table.module.css). Keep this pattern local; global navigation, theme files, DESIGN.md and `.impeccable/design.json` remain outside the change.

## Evidence and limits

The local manual review used real authentication and seven synthetic markers, including a long name, a long unit and a qualitative value. Search returned the expected single marker, and its detail link opened the correct marker. Chromium review covered 1280 × 1000 desktop in light and dark themes and 390 × 844 mobile in the light theme. This evidence does not establish native Safari or physical-device behavior, production-data coverage or a comprehensive accessibility audit.

The final captures inspected for this handoff are temporary task artifacts:

- Desktop light: `/private/tmp/tempo-marker-shots/desktop-light.png`.
- Desktop dark: `/private/tmp/tempo-marker-shots/desktop-dark.png`.
- Mobile light: `/private/tmp/tempo-marker-shots/mobile-light.png`.

These captures show the complete-name treatment, visible reference labels, normal-foreground metadata and the stacked mobile layout. Long-unit and long-qualitative-value handling was also exercised during the local manual review; the listed captures are representative views rather than an exhaustive state gallery. Temporary screenshots are not durable repository fixtures.

## Verification contract

Verification tier: Isolated, because the change is bounded to this feature's presentation. Required checks are formatting, lint, typecheck and the existing compact unit suite (three cases), together with the manual responsive/search/navigation review above. Maintained test-case changes: zero added, zero removed and zero consolidated. No new E2E cases are required for this refinement.

Final automated-check results and the independent review verdict are recorded separately in the task report; this brief does not claim they have passed. Existing authorization, data-isolation and write-integrity coverage remains outside the changed presentation path.
