'use client';
import { offlineMessages } from '@/config/offline';
import { savedFiles } from '@/lib/saved-files';
import { Button, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
const m = offlineMessages.downloads;
export function OfflineSettings() {
  const files = useSyncExternalStore(
    savedFiles.subscribe,
    savedFiles.getSnapshot,
    savedFiles.getServerSnapshot,
  );
  const [failed, setFailed] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function load() {
    setFailed(false);
    try {
      await savedFiles.load();
    } catch {
      setFailed(true);
    }
  }
  useEffect(() => {
    void savedFiles.load().catch(() => setFailed(true));
  }, []);
  async function remove() {
    setBusy(true);
    setRemoveFailed(false);
    try {
      await savedFiles.removeAll();
    } catch {
      setRemoveFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const bytes = files.files.reduce((sum, file) => sum + file.bytes.size, 0);
  return (
    <section id="offline" tabIndex={-1} aria-label={m.title}>
      <Stack gap="sm">
        <Title order={2}>{m.title}</Title>
        <Text c="dimmed">{m.description}</Text>
        {failed ? (
          <>
            <Text role="alert">{m.unavailable}</Text>
            <Button variant="default" onClick={() => void load()}>
              {m.retry}
            </Button>
          </>
        ) : (
          <Text role="status">
            {!files.ready
              ? m.loading
              : files.files.length
                ? m.usage(files.files.length, bytes)
                : m.empty}
          </Text>
        )}
        <Text size="sm" c="dimmed">
          {m.help}
        </Text>
        <Button
          variant="subtle"
          loading={busy}
          disabled={failed || !files.ready || !files.files.length}
          onClick={() => void remove()}
        >
          {m.remove}
        </Button>
        {removeFailed && <Text role="alert">{m.removeFailed}</Text>}
      </Stack>
    </section>
  );
}
