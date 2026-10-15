'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useOfflineLocation, isOfflineRoute } from '@/lib/offline-routing';
import { authClient } from '@/lib/auth-client';
import {
  withOfflineDevicePurge,
  notifyOfflineBlocked,
} from '@/lib/offline-device';
import { Modal, Button, Group, Text } from '@mantine/core';
import { writeMessages } from '@/config/offline-write-messages';
import {
  deleteDeviceWrites,
  hasPendingDeviceWrites,
  syncDeviceWrites,
  withWriteLock,
} from '@/lib/offline-write-client';
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
  const [pendingLogout, setPendingLogout] = useState(false);
  const livePathname = usePathname();
  const localUrl = useOfflineLocation();
  const pathname = isOfflineRoute(localUrl) ? localUrl!.pathname : livePathname;
  const router = useRouter();
  async function logout(discard = false) {
    // Conceal synchronously, before checking persistent storage or waiting on a lock.
    notifyOfflineBlocked();
    try {
      let pending = false;
      try {
        pending = await hasPendingDeviceWrites();
      } catch {
        setCleanupError(true);
      }
      if (!discard && pending) {
        setPendingLogout(true);
        return;
      }
      const result = await withOfflineDevicePurge(
        async () => {
          const finish = async () => {
            try {
              if (!discard && (await hasPendingDeviceWrites()))
                return { pending: true as const };
              await deleteDeviceWrites();
            } catch {
              setCleanupError(true);
            }
            // Storage failure must not trap an authenticated user in the account.
            // The durable auth blocker and server owner partition fence any retained records.
            const response = await authClient.signOut();
            if (response.error) throw new Error('Logout failed');
            return { pending: false as const };
          };
          let entered = false;
          try {
            return await withWriteLock(() => {
              entered = true;
              return finish();
            });
          } catch (error) {
            if (entered) throw error;
            return finish();
          }
        },
        () => setCleanupError(true),
      );
      if (result.pending) {
        setPendingLogout(true);
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setCleanupError(true);
    }
  }
  return (
    <>
      <ApplicationShellFrame
        {...props}
        pathname={pathname}
        linkComponent={Link}
        cleanupError={cleanupError}
        logoutDisabled={!online}
        onLogout={() => logout()}
      >
        {props.children}
      </ApplicationShellFrame>
      <Modal
        opened={pendingLogout}
        onClose={() => setPendingLogout(false)}
        title={writeMessages.review}
      >
        <Text>{writeMessages.logout}</Text>
        <Group mt="md">
          <Button
            mih={44}
            onClick={() => {
              setPendingLogout(false);
              void syncDeviceWrites().catch(() => {});
            }}
          >
            {writeMessages.wait}
          </Button>
          <Button
            mih={44}
            color="red"
            onClick={() => {
              void logout(true);
            }}
          >
            {writeMessages.discardLogout}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
