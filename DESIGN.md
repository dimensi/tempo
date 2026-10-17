---
name: Темпо
description: Существующая визуальная система личного дневника на Mantine
colors:
  primary: '#12b886'
  primary-dark: '#099268'
  paper: '#fff'
  ink: '#000'
  night: '#242424'
  night-ink: '#C9C9C9'
  border: '#ced4da'
  night-border: '#424242'
  muted: '#868e96'
typography:
  headline:
    fontFamily: Arial, system-ui, sans-serif
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: Arial, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: Arial, system-ui, sans-serif
    fontSize: 0.875rem
    lineHeight: 1.45
rounded:
  md: 0.5rem
spacing:
  xs: 0.625rem
  sm: 0.75rem
  md: 1rem
  lg: 1.25rem
  xl: 2rem
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.paper}'
    rounded: '{rounded.md}'
    padding: 0 1.375rem
    height: 44px
  number-field:
    rounded: '{rounded.md}'
    height: 44px
  page-heading:
    typography: '{typography.headline}'
  bordered-paper:
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
---

# Design System: Темпо

## Overview

**Creative North Star: "Существующее рабочее пространство Темпо"**

This describes the incumbent application, rather than a new visual identity. Mantine supplies the component language, a teal accent marks actions and selection, and Arial keeps Russian labels and numerical content familiar. Light and dark themes share the same hierarchy.

The approved shared header gives each page one clear title and its actions. Content uses ordinary fields, restrained borders and explicit interaction states. The workout surface applies this language to a focused daily workspace; its composition and behavioral contract live in [the surface brief](docs/design/workouts-day.md), not in global branding rules.

**Key Characteristics:**

- Mantine components with a single teal action accent.
- Arial typography with compact, legible hierarchy.
- Theme-aware surfaces, borders and text.
- Shared page heading and accessible touch controls.

Evidence: [theme](src/config/theme.ts), [action controls](src/config/action-controls.module.css), [shared header](src/components/layout/page-header.tsx), [application shell](src/components/layout/application-shell-frame.tsx), [global styles](src/styles/global.css), and the installed Mantine theme and component styles. Frontmatter records the reused values at Mantine scale 1; runtime semantic variables remain the authority for theme switching.

## Colors

Teal carries actions against neutral light or dark surfaces. Semantic status colors remain Mantine's existing red, orange and green choices; they are not additional brand accents.

### Primary

- **Action teal** (`primary`): filled actions in the light theme; the dark theme uses `primary-dark` through Mantine's primary shade selection.
- **Quiet teal controls**: subtle and light variants use darker teal text in light mode and lighter teal text in dark mode. Their background mixes the current text color with transparency, rather than adding another fixed palette.
- **Exercise browser controls**: play overlays, selected body categories, selected exercise actions and the add-selected action use the existing Mantine teal shade 9 (`#087f5b`) with white text in both themes. Hover mixes that shade with black (15%). This local contrast treatment does not replace the application's primary shades or add a brand token.

### Neutral

- **Paper / Ink** (`paper`, `ink`): light-theme body and normal text.
- **Night / Night ink** (`night`, `night-ink`): dark-theme body and normal text.
- **Theme borders** (`border`, `night-border`): field outlines and quiet section boundaries.
- **Muted gray** (`muted`): dimmed text in the light theme and the inherited dark dimmed scale value. Use `--mantine-color-dimmed`, not a hardcoded substitution.

**The Semantic Theme Rule.** Use Mantine's body, text, border and primary variables in components so both themes retain their intended relationships.

## Typography

**Body and heading font:** Arial, with system-ui and sans-serif fallbacks. The existing identity does not introduce a separate display face.

### Hierarchy

- **Page heading**: the frontmatter headline role, rendered as a semantic h1 at Mantine h3 size. Keep the page name short; the shared header truncates long titles.
- **Body**: the default Mantine body role for content and forms.
- **Supporting text**: Mantine small text for labels and secondary explanation; extra-small text is reserved for compact status and metadata.
- **Workout numerals**: tabular figures align weight and repetition values. Exercise names and set inputs use the existing local size (17px); this is a workout pattern rather than a replacement global type scale.

**The Single Page Heading Rule.** Put the top-level page title in the shared header; use content headings only for subordinate sections.

## Layout

The application shell has a fixed-height header (68px) and a desktop navigation column (250px). At Mantine's small breakpoint (48em), the mobile burger gives way to the persistent navigation. Main padding changes from `md` to `xl`; keep content shrinkable with `min-width: 0`.

Spacing follows the frontmatter Mantine scale. Header action groups use a tighter local gap (4px), while controls retain their touch area. The workout workspace is centered and bounded (860px); this width is specific to that surface. Its set grid uses fluid numeric columns on mobile and bounded columns from the small breakpoint, with no horizontal overflow.

## Elevation & Depth

The shell and workout rows rely on boundaries and tonal backgrounds. Bordered Paper containers remain valid elsewhere in the application. Drawers, dialogs and menus retain Mantine's overlay behavior; no new shadow vocabulary is introduced by the workout work. Do not infer a global ban on cards or shadows from the flat exercise list.

## Shapes

The default component corner is the frontmatter `md` radius. Keep Mantine's own variant-specific silhouettes, including pill-shaped badges. Exercise sections use straight separators rather than adding a separate card around every exercise.

## Components

### Buttons

Use Mantine Button and ActionIcon. Buttons default to medium size; shared control styling enforces a minimum touch area (44px in each dimension). Filled buttons carry the main action. Subtle and light variants share a tinted background: current color at 9% by default, 15% on hover and 22% while active. Disabled and loading states retain Mantine's treatment. Keyboard focus has an outline (2px) separated from the control (3px).

### Chips

Mantine light badges identify role, muscle group or an existing status. Keep status meaning in text as well as color. Badges are labels; body-category filters and exercise selection use buttons with pressed states. Selected exercise actions include a check icon and a text label.

### Cards / Containers

Existing bordered Paper containers use the theme surface, default rounded corners and a quiet outline. Internal padding follows `sm` or `md` as the content requires. The daily exercise sequence uses dividers; neither treatment should be imposed on unrelated surfaces.

### Inputs / Fields

Use Mantine inputs with visible labels or specific accessible names. Default field borders follow the theme and focus follows the primary accent. Workout numeric fields center their tabular values and have a minimum height (44px). Touch text controls retain readable text (at least 16px) without disabling pinch zoom. Preserve error, disabled and read-only semantics.

### Navigation

The desktop sidebar contains the brand, theme toggle and icon-led section links. Active links use Mantine's selected treatment. Exercise discovery belongs to the add-exercise task and has no standalone navigation item. On mobile the burger opens the navigation; choosing a link closes it. Keep the skip link and current-page semantics.

### Shared page header

PageHeader owns a semantic title and optional actions; the shell owns their placement. PageActions places additional controls in the same header. Actions stay compact and nonwrapping; icon buttons have accessible names and explanatory tooltips where present.

### Exercise rows and media dialog

Plan and result entry use the same name-and-set structure. Exercise names wrap and act as video controls. Technique and personal videos share one focused dialog, full-screen on phones; its transition lasts 180ms, or zero with reduced motion. The description stays openly visible below the technique player. Closing the dialog restores the exercise workspace and its entered sets.

### Exercise picker and gym download

The picker is a full-screen task on phones and a wide dialog on desktop. Search, visible body-category buttons and a muscle filter lead into video cards. The grid becomes one column on small phones; playback opens inside its card. A sticky add-selected action confirms multi-selection together. This focused selection-and-playback flow is the workout signature, rather than a sidebar detail panel.

One workout download action shows data preparation, video progress and a completed state with the saved video count. Partial failure stays explicit and permits retry while retaining completed downloads; exercises without a source video are listed separately. Saved technique video is preferred even online. The precise retention, write-safety and day-flow contract stays in [the surface brief](docs/design/workouts-day.md).

## Do's and Don'ts

### Do:

- **Do** preserve the existing Mantine teal identity and both color themes.
- **Do** use the shared header for page headings and primary page actions.
- **Do** retain visible focus, accessible names and 44px action targets.
- **Do** use semantic theme variables and readable tabular numeric fields.

### Don't:

- **Don't** introduce a new UI kit, display font or replacement brand palette in ordinary feature work.
- **Don't** duplicate the page heading in the content area.
- **Don't** apply workout-specific composition rules to every feature.
- **Don't** use color alone to communicate a status or selection.
