import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@/styles/global.css';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { theme } from '@/config/theme';
import { OfflineLifecycle } from '@/features/offline';
import { OfflineApplication } from './offline-application';
declare const __OFFLINE_BRAND__: string;
const root = document.getElementById('offline-root');
if (root)
  createRoot(root).render(
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <OfflineLifecycle role="OWNER" />
      <OfflineApplication brandSrc={__OFFLINE_BRAND__} />
    </MantineProvider>,
  );
