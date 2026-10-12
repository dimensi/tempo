'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { z } from 'zod';
import {
  transformMateSyncItemSchema,
  type TransformMateSyncItem,
} from '@/contracts/transformmate';
import {
  workoutMessages as m,
  transformMateStatuses as statuses,
  transformMateReasons as reasons,
} from './messages';
export function useTransformMateSync(ownerId: string, version: unknown) {
  const [items, setItems] = useState<TransformMateSyncItem[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(
    async (method = 'POST') => {
      if (inflight.current) return;
      const controller = new AbortController();
      inflight.current = controller;
      const current = generation.current;
      setBusy(true);
      try {
        const response = await fetch(
          `/api/workouts/transformmate?ownerId=${encodeURIComponent(ownerId)}`,
          { method, cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) {
          if (
            !controller.signal.aborted &&
            current === generation.current &&
            (response.status === 401 || response.status === 403)
          ) {
            setItems([]);
            setConfigured(null);
            setDenied(true);
          }
          throw new Error();
        }
        const result = await response.json();
        const parsed = z
          .object({
            configured: z.boolean(),
            items: z.array(transformMateSyncItemSchema),
          })
          .parse(result.data);
        if (!controller.signal.aborted && current === generation.current) {
          setItems(parsed.items);
          setConfigured(parsed.configured);
          setError(false);
          setDenied(false);
        }
      } catch {
        if (!controller.signal.aborted && current === generation.current)
          setError(true);
      } finally {
        if (inflight.current === controller) {
          inflight.current = null;
          setBusy(false);
        }
      }
    },
    [ownerId],
  );
  useEffect(() => {
    const effectGeneration = ++generation.current;
    inflight.current?.abort();
    inflight.current = null;
    void Promise.resolve().then(async () => {
      if (generation.current !== effectGeneration) return;
      await refresh('GET');
      if (generation.current === effectGeneration) await refresh();
    });
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 60_000);
    return () => {
      generation.current = effectGeneration + 1;
      inflight.current?.abort();
      inflight.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, version]);
  return { items, configured, error, busy, refresh, denied };
}
export function SyncSummary({
  sync,
}: {
  sync: ReturnType<typeof useTransformMateSync>;
}) {
  return (
    <Stack gap="xs">
      {sync.configured === false && <Alert>{m.notConfigured}</Alert>}
      {sync.error && (
        <Alert color="red" role="alert">
          {m.syncError}
        </Alert>
      )}
      <Button
        variant="light"
        mih={44}
        loading={sync.busy}
        onClick={() => void sync.refresh()}
      >
        {m.syncRefresh}
      </Button>
    </Stack>
  );
}
export function WorkoutSync({ item }: { item?: TransformMateSyncItem }) {
  if (!item) return null;
  return (
    <Stack gap="xs">
      <Group>
        <Text fw={600}>{m.sync}</Text>
        <Badge
          color={
            (item.status === 'started' && item.actual?.finished) ||
            item.status === 'synced'
              ? 'green'
              : item.status === 'error'
                ? 'red'
                : item.status === 'conflict' || item.status === 'unknown'
                  ? 'orange'
                  : 'gray'
          }
        >
          {item.status === 'started' && item.actual?.finished
            ? m.completed
            : statuses[item.status]}
        </Badge>
      </Group>
      {item.reason && (
        <Text size="sm">
          {item.reason === 'remote_started' && item.actual?.finished
            ? m.completedSafeguard
            : reasons[item.reason]}
        </Text>
      )}
      <Text size="xs" c="var(--mantine-color-text)">
        {m.checked}:{' '}
        {item.checkedAt
          ? new Date(item.checkedAt).toLocaleString('ru-RU')
          : '—'}
      </Text>
      {item.actual && (
        <>
          <Group>
            <Text fw={600}>{m.remoteActual}</Text>
            {item.actual.finished && item.status !== 'started' && (
              <Badge color="green">{m.completed}</Badge>
            )}
          </Group>
          {item.actual.started && (
            <Text size="sm">
              {m.remoteStartedAt}: {item.actual.started}
            </Text>
          )}
          {item.actual.finished && (
            <Text size="sm">
              {m.remoteFinishedAt}: {item.actual.finished}
            </Text>
          )}
          {item.actual.exercises.map((exercise, index) => (
            <Stack gap={4} key={`${exercise.occurrenceKey}-${index}`}>
              <Text>{exercise.name}</Text>
              {exercise.comment && <Text size="sm">{exercise.comment}</Text>}
              {exercise.sets.map((set) => (
                <Text key={set.order} size="sm">
                  {m.set} {set.order}: {set.done ? m.done : m.notDone} ·{' '}
                  {set.metrics
                    .map(
                      (metric) =>
                        `${metric.name}: ${metric.values.length ? metric.values.join(' / ') : '—'} ${metric.unit}`,
                    )
                    .join('; ')}
                </Text>
              ))}
            </Stack>
          ))}
        </>
      )}
    </Stack>
  );
}
