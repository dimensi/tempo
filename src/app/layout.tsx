import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import '@/styles/global.css';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/shared/providers';
import { ru } from '@/config/messages';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

const startupImages = [
  ['440x956', 3, '/branding/splash/iphone-1320x2868.jpg'],
  ['430x932', 3, '/branding/splash/iphone-1290x2796.jpg'],
  ['420x912', 3, '/branding/splash/iphone-1260x2736.jpg'],
  ['402x874', 3, '/branding/splash/iphone-1206x2622.jpg'],
  ['393x852', 3, '/branding/splash/iphone-1179x2556.jpg'],
  ['390x844', 3, '/branding/splash/iphone-1170x2532.jpg'],
  ['414x896', 3, '/branding/splash/iphone-1242x2688.jpg'],
  ['414x896', 2, '/branding/splash/iphone-828x1792.jpg'],
  ['375x812', 3, '/branding/splash/iphone-1125x2436.jpg'],
  ['375x667', 2, '/branding/splash/iphone-750x1334.jpg'],
  ['320x568', 2, '/branding/splash/iphone-640x1136.jpg'],
] as const;

export const metadata: Metadata = {
  title: { default: ru.appName, template: `%s · ${ru.appName}` },
  description: 'Личное пространство питания и тренировок',
  icons: {
    icon: [
      { url: '/branding/mark.svg', type: 'image/svg+xml' },
      { url: '/branding/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/branding/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: {
      url: '/branding/apple-touch-icon.png',
      sizes: '180x180',
      type: 'image/png',
    },
  },
  appleWebApp: {
    capable: true,
    title: ru.appName,
    statusBarStyle: 'black-translucent',
    startupImage: startupImages.map(([viewport, ratio, url]) => {
      const [width, height] = viewport.split('x');

      return {
        url,
        media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
      };
    }),
  },
  other: { 'apple-mobile-web-app-capable': 'yes' },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <div className="pwa-top-edge" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
