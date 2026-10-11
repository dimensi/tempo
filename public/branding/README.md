# Питание и движение

Original application identity: an open plate/orbit, an ascending leaf and a lime
motion accent. This is independent branding, not the YAZIO identity.

- `mark.svg`: transparent master for the header and login page; teal `#0ca678`.
- `app.svg`: rounded app tile, white mark on Mantine teal `#087f5b`.
- `maskable.svg`: full-bleed tile; the mark stays inside the central safe circle
  with radius 40% of the canvas width.
- PNG exports: 16/32px favicons, 180px Apple touch icon, 192/512px app icons and
  a separate 512px maskable icon. `src/app/favicon.ico` contains 16/32/48px PNGs.

Keep the SVG geometry as the source of truth. Export each PNG directly from its
master at the target size; avoid enlarging smaller PNGs. The adjacent application
name labels the decorative mark in the UI. Manifest and root metadata reference
only committed local assets. Installing a home-screen shortcut does not provide
offline support.
