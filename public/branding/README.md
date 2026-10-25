# Темпо

Original application identity: an open plate/orbit, an ascending leaf and a lime
motion accent. This is independent branding, not the YAZIO identity.

- `mark.svg`: original transparent master; teal `#0ca678`. Still used on the
  login page and retained as the primary application logo.
- `tempo-joke.jpg`: user-supplied candy-wrapper image, used temporarily in the
  mobile header and desktop sidebar just for fun. This is not a rebrand.
- `app.svg`: rounded app tile, white mark on Mantine teal `#087f5b`.
- `maskable.svg`: full-bleed tile; the mark stays inside the central safe circle
  with radius 40% of the canvas width.
- PNG exports: 16/32px favicons, 180px Apple touch icon, 192/512px app icons and
  a separate 512px maskable icon. `src/app/favicon.ico` contains 16/32/48px PNGs.
- `splash/`: branded portrait launch images for installed iOS web apps. Root
  metadata maps each file to its exact device viewport and pixel ratio through
  `apple-touch-startup-image`; the manifest background matches the artwork so
  uncovered or newer device sizes still open without a white flash. Each launch
  image composites the unchanged current `app-512.png` over the generated
  background; the logo itself is not generated or redrawn.

Keep the SVG geometry as the source of truth. Export each PNG directly from its
master at the target size; avoid enlarging smaller PNGs. The adjacent application
name labels the decorative mark in the UI. Manifest and root metadata reference
only committed local assets. Installing a home-screen shortcut does not provide
offline support.

## Оригинальный логотип сохраняем

Оригинальный логотип Tempo нужен и остаётся основным: не удалять и не перезаписывать
`mark.svg`, `app.svg`, `maskable.svg`, PNG-экспорты, favicon и экраны запуска.
`tempo-joke.jpg` — временная шуточная замена только в шапке и боковой панели.
Чтобы вернуть оригинал, укажите `/branding/mark.svg` как значение `brandSrc` по
умолчанию в `src/components/layout/application-shell-frame.tsx` и верните размеры
обоих изображений с 44×44 на 28×28. Новую картинку не использовать как мастер для
иконок приложения или экранов запуска.
