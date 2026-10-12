'use client';
import { useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { getOfflineController } from './controller';
import { offlineMessages as m } from './messages';
const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function OfflineSettings() {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const today = ready
    ? dateInTimezone(
        new Date(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      )
    : '';
  const [selection, setPeriod] = useState<{
    from: string | null;
    to: string | null;
  }>({ from: null, to: null });
  const period = {
    from: selection.from ?? (today ? shiftDate(today, -6) : ''),
    to: selection.to ?? today,
  };
  const busy = state.status === 'saving' || state.status === 'checking';
  return (
    <section id="offline" tabIndex={-1} aria-label={m.title}>
      <Stack>
        <Title order={2}>{m.title}</Title>
        <Text>{m.description}</Text>
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
              {m.until}:{' '}
              {new Date(state.bundle.expiresAt).toLocaleString('ru-RU')}
            </Text>
            <Text>
              {m.photoCoverage}: {state.photos.length} /{' '}
              {state.bundle.snapshot.photos.items.length}
            </Text>
            {state.bundle.missingPhotos.length > 0 && (
              <Text>{m.partialPhotos}</Text>
            )}
            <Anchor href="/offline/index.html">{m.open}</Anchor>
          </Stack>
        ) : (
          <Text>{m.off}</Text>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || busy) return;
            void controller.save(period);
          }}
        >
          <Stack>
            <Group align="end">
              <TextInput
                label={m.from}
                type="date"
                required
                value={period.from}
                disabled={!ready || busy}
                onChange={(event) =>
                  setPeriod({ ...period, from: event.currentTarget.value })
                }
                style={{ flex: '1 1 150px' }}
              />
              <TextInput
                label={m.to}
                type="date"
                required
                value={period.to}
                disabled={!ready || busy}
                onChange={(event) =>
                  setPeriod({ ...period, to: event.currentTarget.value })
                }
                style={{ flex: '1 1 150px' }}
              />
            </Group>
            <Text>{m.range}</Text>
            <Group>
              <Button
                type="submit"
                loading={state.status === 'saving'}
                disabled={!ready || state.status === 'checking'}
                mih={44}
              >
                {state.bundle ? m.refresh : m.enable}
              </Button>
              <Button
                variant="outline"
                mih={44}
                disabled={!ready}
                onClick={() => void controller.disable()}
              >
                {m.disable}
              </Button>
            </Group>
          </Stack>
        </form>
        {state.status === 'saving' && <Text role="status">{m.saving}</Text>}
        {state.status === 'checking' && <Text role="status">{m.checking}</Text>}
      </Stack>
    </section>
  );
}
