import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@/styles/global.css';
import { useSyncExternalStore } from 'react';
import { getOfflineController } from '@/lib/offline-controller';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { theme } from '@/config/theme';
import { OfflineLifecycle } from '@/features/offline';
import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { PrivateReadWorkspace } from './read-workspace';
declare const __OFFLINE_BRAND__: string;
if (location.pathname === '/offline/index.html')
  history.replaceState({}, '', '/');
const root = document.getElementById('offline-root');
function Application() {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <OfflineLifecycle role="OWNER" />
      <ApplicationShell
        brandSrc={__OFFLINE_BRAND__}
        role={state.bundle?.snapshot.role ?? 'OWNER'}
        demo={false}
      >
        <ContentLayout>
          <PrivateReadWorkspace initialRole={state.bundle?.snapshot.role} />
        </ContentLayout>
      </ApplicationShell>
    </MantineProvider>
  );
}
if (root) createRoot(root).render(<Application />);
