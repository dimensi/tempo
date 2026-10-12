# Reports

The authorized owner/trainer form exports a daily, seven-day or custom diary range through `/api/reports`. Both date fields initialize once from the browser calendar after hydration. Weekly mode uses the selected start plus six calendar days and displays both inclusive dates with month/year; switching modes preserves manual edits and explicit clearing. Inputs use at least 16 px text without restricting browser zoom.

HTML preview and downloaded PDF share the prepared A4 layout. Rendering, source adaptation, photo selection, embedded font licensing, authorization, limits and verification are documented in [the PDF runtime guide](../../server/pdf/README.md). No feature imports another feature, and the browser receives no server credentials or database access.
