'use client';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Alert, Anchor, Stack, Switch, Text, Title } from '@mantine/core';
import { revealOfflineContent } from '@/lib/offline-device';
import { getOfflineController } from './controller';
import { offlineMessages as m } from './messages';
export function OfflineSettings() {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useLayoutEffect(() => {
    if (state.bundle) revealOfflineContent(state.bundle.fence);
  }, [state]);
  return (
    <section id="offline" tabIndex={-1} aria-label={m.title}>
      <Stack>
        <Title order={2}>{m.title}</Title>
        <Switch
          label={m.enabledLabel}
          checked={state.enabled}
          disabled={state.status === 'checking' && !state.enabled}
          onChange={(event) => {
            if (event.currentTarget.checked) void controller.save();
            else void controller.disable();
          }}
          size="md"
          styles={{
            label: {
              fontSize: 16,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
            },
          }}
        />
        <Text>{m.description}</Text>
        <Text>{m.background}</Text>
        <Text>{m.disclosure}</Text>
        {state.error && (
          <Alert color="red" role="alert">
            {m[state.error]}
          </Alert>
        )}
        {state.bundle ? (
          <Stack gap="xs" data-offline-private>
            <Text>
              {m.saved}: {state.bundle.snapshot.from} —{' '}
              {state.bundle.snapshot.to}
            </Text>
            <Text>
              {m.checked}:{' '}
              {new Date(state.bundle.savedAt).toLocaleString('ru-RU')}
            </Text>
            <Text>
              {m.photoCoverage}: {state.photos.length} /{' '}
              {state.bundle.snapshot.photos.items.length}
            </Text>
            {state.bundle.missingPhotos.length > 0 && (
              <Text>{m.partialPhotos}</Text>
            )}
            <Anchor
              href="/offline/index.html"
              c="var(--mantine-color-text)"
              style={{
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {m.open}
            </Anchor>
          </Stack>
        ) : (
          !state.enabled && <Text>{m.off}</Text>
        )}
        {state.status === 'saving' && <Text role="status">{m.saving}</Text>}
        {state.status === 'checking' && <Text role="status">{m.checking}</Text>}
      </Stack>
    </section>
  );
}
