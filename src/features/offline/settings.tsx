'use client';
import { useSyncExternalStore } from 'react';
import { Alert, Stack, Text, Title } from '@mantine/core';
import { getOfflineController } from './controller';
import { offlineMessages as m } from './messages';
export function OfflineSettings() {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return (
    <section id="offline" tabIndex={-1} aria-label={m.title}>
      <Stack>
        <Title order={2}>{m.title}</Title>
        <Text>{m.description}</Text>
        <Text>{m.background}</Text>
        <Text>{m.disclosure}</Text>
        {state.error && <Alert role="alert">{m[state.error]}</Alert>}
        {state.bundle && (
          <Text>
            {m.checked}:{' '}
            {new Date(state.bundle.savedAt).toLocaleString('ru-RU')}
          </Text>
        )}
        {state.bundle?.missingPhotos.length ? (
          <Text>{m.partialPhotos}</Text>
        ) : null}
      </Stack>
    </section>
  );
}
