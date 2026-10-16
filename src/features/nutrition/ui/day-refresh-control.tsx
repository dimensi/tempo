'use client';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';

import { readWorkspaceMessages } from '@/config/read-workspace';
import { syncResultKind } from '@/contracts/nutrition-sync';
import { useReadOnline } from '@/lib/use-read-online';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { diaryMessages as m } from './messages';

export function DayRefreshControl({
  date,
  onUpdated,
}: {
  date: string;
  onUpdated: () => void;
}) {
  const online = useReadOnline();
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<
    'loaded' | 'photos-pending' | 'incomplete' | 'busy' | null
  >(null);
  useEffect(() => () => request.current?.abort(), [date]);

  async function refresh() {
    if (request.current) return;
    const selected = () =>
      new URLSearchParams(window.location.search).get('date') === date;
    if (!selected()) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setOutcome(null);
    try {
      const response = await apiFetch(
        `/api/nutrition/days/${encodeURIComponent(date)}/refresh`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || !selected()) return;
      if (response.status === 409) {
        setOutcome('busy');
        return;
      }
      if (!response.ok) throw new Error('Day refresh failed');
      const result = apiResults.dayRefresh(await response.json());
      if (controller.signal.aborted || !selected()) return;
      setOutcome(syncResultKind(result));
      // Refresh only this still-selected route after its completed mutation.
      // Navigation/unmount aborts the client request and suppresses late updates.
      onUpdated();
    } catch {
      if (!controller.signal.aborted && selected()) setOutcome('incomplete');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <Stack gap="xs">
      <Group gap="sm">
        <Button
          variant="light"
          mih={44}
          loading={pending}
          disabled={!online}
          title={!online ? readWorkspaceMessages.refreshUnavailable : undefined}
          onClick={() => void refresh()}
        >
          {m.refreshDay}
        </Button>
        {pending && (
          <Text size="sm" role="status">
            {m.refreshRunning}
          </Text>
        )}
      </Group>
      {outcome && (
        <Alert
          color={
            outcome === 'loaded'
              ? 'green'
              : outcome === 'photos-pending'
                ? 'yellow'
                : 'red'
          }
          role="status"
        >
          {m.refreshOutcomes[outcome]}
        </Alert>
      )}
    </Stack>
  );
}
