'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { getOfflineController } from '@/lib/offline-controller';
import { offlineFileMessages as m } from '@/config/offline-files';
export function OfflineFile({
  id,
  label,
  href,
  kind,
  size,
  offline = false,
}: {
  id: string;
  label: string;
  href?: string;
  kind: 'pdf' | 'video';
  size?: number;
  offline?: boolean;
}) {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const file = state.files.find((file) => file.id === id);
  const [resource, setResource] = useState<{ bytes: Blob; url: string } | null>(
    null,
  );
  const [preflight, setPreflight] = useState<{
    href: string;
    size: number | null;
  } | null>(null);
  const prepared = preflight?.href === href;
  const knownSize = size ?? (prepared ? preflight?.size : undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file.bytes);
    // Object URLs exist only while the matching account bundle is visible.
    const timer = setTimeout(() => setResource({ bytes: file.bytes, url }), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const url = file?.bytes === resource?.bytes ? resource?.url : undefined;
  async function change(remove: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      if (remove) await controller.removeFile(id);
      else if (href) {
        if (size === undefined && !prepared)
          setPreflight({ href, size: await controller.fileSize(href) });
        else
          await controller.saveFile({
            id,
            label,
            href,
            kind,
            size: kind === 'pdf' ? undefined : (knownSize ?? undefined),
          });
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack gap="xs" style={{ minWidth: 0 }}>
      <Text fw={500} style={{ overflowWrap: 'anywhere' }}>
        {label}
      </Text>
      <Text size="sm" c="dimmed">
        {file
          ? `${m.saved} · ${(file.bytes.size / 1024 / 1024).toFixed(1)} ${m.mib}`
          : knownSize
            ? `${(knownSize / 1024 / 1024).toFixed(1)} ${m.mib}`
            : prepared
              ? m.sizeUnknown
              : m.size}
      </Text>
      {failed && (
        <Alert role="status" color="orange">
          {m.failed}
        </Alert>
      )}
      {offline && !file && <Text>{m.missing}</Text>}
      <Group>
        {url && (
          <Button
            component="a"
            href={url}
            target="_blank"
            rel="noopener"
            mih={44}
            variant="default"
          >
            {m.open}
          </Button>
        )}
        {file ? (
          <Button
            mih={44}
            loading={busy}
            variant="subtle"
            onClick={() => void change(true)}
          >
            {m.remove}
          </Button>
        ) : (
          <Button
            mih={44}
            loading={busy}
            disabled={offline || !href || !state.bundle}
            onClick={() => void change(false)}
          >
            {size === undefined && !prepared ? m.size : m.save}
          </Button>
        )}
      </Group>
      {offline && url && kind === 'video' && (
        <video
          data-offline-private
          controls
          playsInline
          preload="none"
          src={url}
          style={{ width: '100%', maxHeight: 400 }}
        />
      )}
    </Stack>
  );
}
