'use client';
import { useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Group,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import classes from './replica-status.module.css';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { useReadOnline } from '@/lib/use-read-online';
import {
  replicaMessages as m,
  type TransformMateReplicaStatus,
} from '@/contracts/transformmate-replica';
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
function fileSize(bytes: number) {
  const unit = bytes
    ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))
    : 0;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${m.units[unit]}`;
}
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
  const paused = status?.reason === 'disconnected' || status?.reason === 'auth';
  const badge = status?.reason
    ? paused
      ? status.total
        ? m.saved
        : m.paused
      : m.retrying
    : status?.pending
      ? m.filling
      : m.automatic;
  return (
    <Box className={classes.panel} aria-busy={!status && !failed}>
      <Group justify="space-between" align="start" gap="sm" wrap="wrap">
        <Stack gap={4}>
          <Title order={3} size="h3">
            {m.title}
          </Title>
          <Text size="sm" c="dimmed">
            {status ? `${number(status.total)} ${m.catalog}` : m.loading}
          </Text>
        </Stack>
        {status && (
          <Badge
            variant="light"
            color={paused ? 'gray' : status.reason ? 'yellow' : 'teal'}
          >
            {badge}
          </Badge>
        )}
      </Group>
      {failed && (
        <Alert mt="md" color="yellow">
          {m.unavailable}
        </Alert>
      )}
      {!status && !failed && (
        <SimpleGrid cols={3} mt="lg" aria-label={m.loading}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={92} />
          ))}
        </SimpleGrid>
      )}
      {status && (
        <>
          {status.reason && (
            <Text size="sm" mt="md" c={paused ? 'dimmed' : undefined}>
              {m[status.reason]}
            </Text>
          )}
          {status.total === 0 ? (
            <Text mt="lg" size="sm">
              {configured ? m.emptyConnected : m.empty}
            </Text>
          ) : (
            <div className={classes.coverage}>
              {(
                [
                  [m.descriptions, status.descriptions],
                  [m.videos, status.videos],
                  [m.previews, status.previews],
                ] as const
              ).map(([label, count]) => {
                const percent = Math.min(100, (count / status.total) * 100);
                return (
                  <Stack gap={6} key={label}>
                    <Text size="sm" fw={500}>
                      {label}
                    </Text>
                    <Text className={classes.count}>{number(count)}</Text>
                    <Progress
                      value={percent}
                      size={6}
                      radius="xl"
                      color="teal"
                      aria-label={label}
                      aria-valuetext={`${number(count)} / ${number(status.total)}`}
                    />
                    <Text size="sm" c="dimmed">
                      {Math.round(percent)}% {m.catalogShare}
                    </Text>
                  </Stack>
                );
              })}
            </div>
          )}
          <dl className={classes.metrics}>
            {[
              [m.storageSize, fileSize(status.bytes)],
              [m.queue, number(status.pending)],
            ].map(([label, value]) => (
              <div key={label}>
                <Text component="dt" size="sm" c="dimmed">
                  {label}
                </Text>
                <Text
                  component="dd"
                  m={0}
                  fw={600}
                  className={classes.metricValue}
                >
                  {value}
                </Text>
              </div>
            ))}
          </dl>
          <dl className={classes.schedule}>
            {[
              [m.updated, status.lastSuccessAt],
              [m.scheduled, status.nextAttemptAt],
            ].map(([label, value]) => (
              <div key={label}>
                <Text component="dt" size="sm" c="dimmed">
                  {label}
                </Text>
                <Text component="dd" size="sm" m={0}>
                  {value ? <time dateTime={value}>{date(value)}</time> : '—'}
                </Text>
              </div>
            ))}
          </dl>
          <Accordion
            variant="default"
            mt="md"
            classNames={{ control: classes.disclosure }}
          >
            {status.failureGroups.map((group) => (
              <Accordion.Item key={group.stage} value={group.stage}>
                <Accordion.Control>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm">{m.failureStages[group.stage]}</Text>
                    <Badge
                      size="sm"
                      color={group.stage === 'image' ? 'yellow' : 'red'}
                      variant="light"
                    >
                      {number(group.count)}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    {group.stage === 'image' && (
                      <Text size="sm" c="dimmed">
                        {m.imageFailureHint}
                      </Text>
                    )}
                    {group.examples.map((failure) => (
                      <div key={failure.id}>
                        <Text size="sm" fw={600}>
                          {m.failedExercise} #{failure.id}
                        </Text>
                        <Text size="sm">
                          {group.stage === 'metadata' &&
                          failure.reason === 'not_found'
                            ? m.missingExercise
                            : m.failureReasons[failure.reason]}
                          {failure.httpStatus !== null
                            ? ` (${m.httpStatus} ${failure.httpStatus})`
                            : ''}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {m.retryLabel}: {date(failure.nextAttemptAt)}
                        </Text>
                      </div>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
            <Accordion.Item value="storage">
              <Accordion.Control>
                <Text size="sm">{m.details}</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" c="dimmed">
                  {m.description}
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}
    </Box>
  );
}
