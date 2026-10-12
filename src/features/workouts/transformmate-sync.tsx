'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { z } from 'zod';
import {
  transformMateSyncItemSchema,
  type TransformMateSyncItem,
} from '@/contracts/transformmate';
import {
  transformMateNativePageSchema,
  transformMateNativeRefreshSchema,
  type TransformMateNativePage,
  type TransformMateNativeRefresh,
} from '@/contracts/transformmate-native';
import {
  workoutMessages as m,
  transformMateStatuses as statuses,
  transformMateReasons as reasons,
} from './messages';
export function useTransformMateSync(
  ownerId: string,
  version: unknown,
  date: string,
) {
  const [nativePage, setNativePage] = useState<TransformMateNativePage>({
    items: [],
    nextCursor: null,
  });
  const [nativeRefresh, setNativeRefresh] =
    useState<TransformMateNativeRefresh>({
      status: 'idle',
      checkedAt: null,
      errorCode: null,
    });
  const lastAutomatic = useRef(0);
  const [items, setItems] = useState<TransformMateSyncItem[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(
    async (method = 'POST', cursor?: string, automatic = false) => {
      if (
        inflight.current ||
        (automatic && Date.now() - lastAutomatic.current < 60_000)
      )
        return;
      if (automatic) lastAutomatic.current = Date.now();
      const controller = new AbortController();
      inflight.current = controller;
      const current = generation.current;
      setBusy(true);
      try {
        const response = await fetch(
          `/api/workouts/transformmate?${new URLSearchParams({ ownerId, from: date, to: date, limit: '20', ...(cursor ? { cursor } : {}) })}`,
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
            setNativePage({ items: [], nextCursor: null });
            setDenied(true);
          }
          throw new Error();
        }
        const result = await response.json();
        const parsed = z
          .object({
            configured: z.boolean(),
            items: z.array(transformMateSyncItemSchema),
            nativePage: transformMateNativePageSchema,
            nativeRefresh: transformMateNativeRefreshSchema,
          })
          .parse(result.data);
        if (!controller.signal.aborted && current === generation.current) {
          setItems(parsed.items);
          setNativePage((previous) =>
            cursor
              ? {
                  items: [
                    ...previous.items,
                    ...parsed.nativePage.items.filter(
                      (item) =>
                        !previous.items.some(
                          (entry) =>
                            entry.remoteTrainingId === item.remoteTrainingId,
                        ),
                    ),
                  ],
                  nextCursor: parsed.nativePage.nextCursor,
                }
              : parsed.nativePage,
          );
          if (!cursor) setNativeRefresh(parsed.nativeRefresh);
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
    [ownerId, date],
  );
  useEffect(() => {
    const effectGeneration = ++generation.current;
    inflight.current?.abort();
    inflight.current = null;
    lastAutomatic.current = 0;
    void Promise.resolve().then(async () => {
      if (generation.current !== effectGeneration) return;
      setNativePage({ items: [], nextCursor: null });
      setNativeRefresh({ status: 'idle', checkedAt: null, errorCode: null });
      await refresh('GET');
      if (generation.current === effectGeneration)
        await refresh('POST', undefined, true);
    });
    const visible = () => {
      if (document.visibilityState === 'visible')
        void refresh('POST', undefined, true);
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
  return {
    items,
    nativePage,
    nativeRefresh,
    configured,
    error,
    busy,
    refresh,
    denied,
    loadMore: () =>
      nativePage.nextCursor && refresh('POST', nativePage.nextCursor),
  };
}
export function SyncSummary({
  sync,
}: {
  sync: ReturnType<typeof useTransformMateSync>;
}) {
  if (sync.configured === false)
    return (
      <Text size="sm" c="dimmed">
        {m.notConfigured}
      </Text>
    );
  return (
    <Stack gap="xs">
      {(sync.nativeRefresh.status === 'error' ||
        sync.nativeRefresh.status === 'unavailable') && (
        <Alert color="orange" role="alert">
          {sync.nativeRefresh.errorCode === 'reauth_required'
            ? m.nativeReconnect
            : m.nativeError}
        </Alert>
      )}
      {sync.nativeRefresh.checkedAt && (
        <Text size="sm">
          {m.checked}:{' '}
          {new Date(sync.nativeRefresh.checkedAt).toLocaleString('ru-RU')}
        </Text>
      )}
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
export function WorkoutSync({
  item,
  showActual = true,
}: {
  item?: TransformMateSyncItem;
  showActual?: boolean;
}) {
  if (!item || (!showActual && item.reason === 'not_configured')) return null;
  const unpublished =
    item.reason === 'unsupported' && item.remoteTrainingId === null;
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
            : unpublished
              ? m.notPublished
              : statuses[item.status]}
        </Badge>
      </Group>
      {item.reason && !unpublished && (
        <Text size="sm">
          {item.reason === 'remote_started' && item.actual?.finished
            ? m.completedSafeguard
            : unpublished
              ? m.notPublished
              : reasons[item.reason]}
        </Text>
      )}
      {item.updateAttempt && (
        <Text size="sm" role="status">
          {
            {
              pending: m.updatePending,
              unknown: m.updateUnknown,
              verified: m.updateVerified,
              conflict: m.updateConflict,
            }[item.updateAttempt.phase]
          }
        </Text>
      )}
      {item.checkedAt && (
        <Text size="xs" c="var(--mantine-color-text)">
          {m.checked}:{' '}
          {item.checkedAt
            ? new Date(item.checkedAt).toLocaleString('ru-RU')
            : '—'}
        </Text>
      )}
      {showActual && item.actual && (
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
