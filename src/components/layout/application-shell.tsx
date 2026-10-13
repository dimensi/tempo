'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { withOfflineDevicePurge } from '@/lib/offline-device';
import { ApplicationShellFrame } from './application-shell-frame';
export function ApplicationShell(props: {
  children: React.ReactNode;
  role: string;
  demo: boolean;
}) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const [cleanupError, setCleanupError] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  return (
    <ApplicationShellFrame
      {...props}
      pathname={pathname}
      linkComponent={Link}
      cleanupError={cleanupError}
      logoutDisabled={!online}
      onLogout={async () => {
        const result = await withOfflineDevicePurge(
          () => authClient.signOut(),
          () => setCleanupError(true),
        );
        if (result.error) throw new Error('Logout failed');
        router.replace('/login');
        router.refresh();
      }}
    />
  );
}
