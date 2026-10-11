import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import '@/styles/global.css';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import { Providers } from '@/components/shared/providers';
export const metadata = {
  title: { default: 'Питание и движение', template: '%s · Питание и движение' },
  description: 'Личное пространство питания и тренировок',
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
