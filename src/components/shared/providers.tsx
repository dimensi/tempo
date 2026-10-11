'use client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from '@/config/theme';
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications />
      {children}
    </MantineProvider>
  );
}
