'use client';
import { useEffect, useState } from 'react';
import { Alert, Group, Stack, Text, Title } from '@mantine/core';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { useReadOnline } from '@/lib/use-read-online';
import {
  replicaMessages as m,
  type TransformMateReplicaStatus,
} from '@/contracts/transformmate-replica';
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU') : '—';
export function ReplicaStatus({ configured }: { configured: boolean }) {
  const online = useReadOnline();
  const [status, setStatus] = useState<TransformMateReplicaStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const response = await apiFetch('/api/transformmate/replica', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unavailable');
        const result = apiResults.replica(await response.json());
        if (!controller.signal.aborted) {
          setStatus(result);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [online, configured]);
  const rows = status
    ? [
        [m.descriptions, `${status.descriptions} / ${status.total}`],
        [m.videos, `${status.videos} / ${status.total}`],
        [m.previews, `${status.previews} / ${status.total}`],
        [
          m.bytes,
          `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(status.bytes / 1024 ** 2)} МБ`,
        ],
        [m.pending, String(status.pending)],
        [m.errors, String(status.errors)],
        [m.lastSuccess, date(status.lastSuccessAt)],
        [m.nextAttempt, date(status.nextAttemptAt)],
      ]
    : [];
  return (
    <Stack gap="sm" mt="md">
      <Title order={3}>{m.title}</Title>
      <Text size="sm">{m.description}</Text>
      {failed && <Alert color="yellow">{m.unavailable}</Alert>}
      {!status && !failed && <Text size="sm">{m.loading}</Text>}
      {status && (
        <>
          <Text size="sm">{status.reason ? m[status.reason] : m.ready}</Text>
          {status.total === 0 ? (
            <Text size="sm">{m.empty}</Text>
          ) : (
            <Stack gap="xs" component="dl" m={0}>
              {rows.map(([label, value]) => (
                <Group
                  key={label}
                  justify="space-between"
                  align="baseline"
                  gap="xs"
                  wrap="wrap"
                >
                  <Text component="dt" size="sm">
                    {label}
                  </Text>
                  <Text
                    component="dd"
                    size="sm"
                    m={0}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {value}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
          {status.failedExercises.map((failure) => (
            <Text key={failure.id} size="sm">
              {m.failedExercise} #{failure.id}:{' '}
              {m.failureReasons[failure.reason]}. {m.nextAttempt}:{' '}
              {date(failure.nextAttemptAt)}
            </Text>
          ))}
        </>
      )}
    </Stack>
  );
}
