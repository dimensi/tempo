'use client';
import { writeMessages } from '@/config/offline-write-messages';
import { endClientSession, requestLocalLogout } from '@/lib/local-logout';
import { syncDeviceWrites } from '@/lib/offline-write-client';
import { Button, Group, Modal, Text } from '@mantine/core';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApplicationShellFrame } from './application-shell-frame';
export function ApplicationShell(props: {
  children: React.ReactNode;
  role: string;
  demo: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingLogout, setPendingLogout] = useState(false);
  const [cleanupError, setCleanupError] = useState(false);
  async function logout(discard = false) {
    try {
      if ((await requestLocalLogout(discard)) === 'pending') {
        setPendingLogout(true);
        return;
      }
    } catch {
      setCleanupError(true);
      await endClientSession(false).catch(() => {});
    }
    if (navigator.onLine) router.replace('/login');
  }
  return (
    <>
      <ApplicationShellFrame
        {...props}
        pathname={pathname}
        linkComponent={Link}
        cleanupError={cleanupError}
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
            onClick={() => {
              setPendingLogout(false);
              void syncDeviceWrites().catch(() => {});
            }}
          >
            {writeMessages.wait}
          </Button>
          <Button color="red" onClick={() => void logout(true)}>
            {writeMessages.discardLogout}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
