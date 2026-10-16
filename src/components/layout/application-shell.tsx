'use client';
import { useState } from 'react';
import { ReadLink } from '@/components/shared/read-link';
import { useReadLocation } from '@/lib/workspace-navigation';
import {
  beginLocalLogout,
  finishPendingLogout,
  hasPendingLogout,
} from '@/lib/local-logout';
import { withOfflineDevicePurge } from '@/lib/offline-device';
import { deleteDeviceWrites, withWriteLock } from '@/lib/offline-write-client';
import { ApplicationShellFrame } from './application-shell-frame';
export function ApplicationShell(props: {
  children: React.ReactNode;
  role: string;
  demo: boolean;
}) {
  const [cleanupError, setCleanupError] = useState(false);
  const pathname = new URL(useReadLocation() || '/', 'https://tempo.local')
    .pathname;
  async function logout() {
    try {
      beginLocalLogout();
      await withOfflineDevicePurge(
        async () => {
          await withWriteLock(() => deleteDeviceWrites()).catch(() =>
            setCleanupError(true),
          );
        },
        () => setCleanupError(true),
      );
      await finishPendingLogout();
      if (!hasPendingLogout()) location.replace('/login');
      else {
        history.replaceState({}, '', '/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch {
      setCleanupError(true);
    }
  }
  return (
    <ApplicationShellFrame
      {...props}
      pathname={pathname}
      linkComponent={ReadLink}
      cleanupError={cleanupError}
      onLogout={logout}
    >
      {props.children}
    </ApplicationShellFrame>
  );
}
