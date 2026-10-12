import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import '@/styles/global.css';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import { Providers } from '@/components/shared/providers';
import { ru } from '@/config/messages';
export const metadata = {
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
