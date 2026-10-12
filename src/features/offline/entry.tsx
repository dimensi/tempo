import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@/styles/global.css';
import { createRoot } from 'react-dom/client';
import { MantineProvider, Image } from '@mantine/core';
import { theme } from '@/config/theme';
import { OfflineViewer } from './view';
import classes from './offline.module.css';
import { offlineMessages as m } from './messages';
declare const __OFFLINE_BRAND__: string;
const root = document.getElementById('offline-root');
if (root)
  createRoot(root).render(
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <header className={classes.brand}>
        <Image src={__OFFLINE_BRAND__} w={32} h={32} alt="" />
        {m.appName}
      </header>
      <OfflineViewer />
    </MantineProvider>,
  );
