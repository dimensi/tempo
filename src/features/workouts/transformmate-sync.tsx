'use client';
import { type TransformMateSyncItem } from '@/contracts/transformmate';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { seedClientRead } from '@/lib/client-read';
import { readResources } from '@/lib/read-descriptors';
import { sessionGeneration } from '@/lib/session-state';
import { useReadOnline } from '@/lib/use-read-online';
import { useReadResource } from '@/lib/use-read-resource';
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  workoutMessages as m,
  transformMateReasons as reasons,
  transformMateStatuses as statuses,
} from './messages';
export function useTransformMateSync(
  ownerId: string,
  version: unknown,
  date: string,
) {
  const lastAutomatic = useRef(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const url = `/api/workouts/transformmate?${new URLSearchParams({ ownerId, from: date, to: date, limit: '20' })}`;
  const resource = useReadResource(readResources.transformMate(url));
  const refreshRead = resource.refresh;
  const currentData = useRef(resource.data);
  useEffect(() => {
    currentData.current = resource.data;
  }, [resource.data]);
  const items = resource.data?.items ?? [];
  const nativePage = resource.data?.nativePage ?? {
    items: [],
    nextCursor: null,
  };
  const nativeRefresh = resource.data?.nativeRefresh ?? {
    status: 'idle' as const,
    checkedAt: null,
    errorCode: null,
  };
  const configured = resource.data?.configured ?? null;
  const refresh = useCallback(
    async (cursor?: string, automatic = false) => {
      if (
        !navigator.onLine ||
        inflight.current ||
        (automatic && Date.now() - lastAutomatic.current < 60_000)
      )
        return;
      if (automatic) lastAutomatic.current = Date.now();
      const controller = new AbortController();
      inflight.current = controller;
      const current = generation.current;
      const session = sessionGeneration();
      setBusy(true);
      try {
        await refreshRead();
        if (
          controller.signal.aborted ||
          current !== generation.current ||
          session !== sessionGeneration()
        )
          return;
        const response = await apiFetch(
          `/api/workouts/transformmate?${new URLSearchParams({ ownerId, from: date, to: date, limit: '20', ...(cursor ? { cursor } : {}) })}`,
          { method: 'POST', cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const result = await response.json();
        const parsed = apiResults.transformMate(result.data);
        if (!controller.signal.aborted && current === generation.current) {
          const previous = currentData.current;
          const data =
            cursor && previous
              ? {
                  ...previous,
                  nativePage: {
                    items: [
                      ...previous.nativePage.items,
                      ...parsed.nativePage.items.filter(
                        (item) =>
                          !previous.nativePage.items.some(
                            (entry) =>
                              entry.remoteTrainingId === item.remoteTrainingId,
                          ),
                      ),
                    ],
                    nextCursor: parsed.nativePage.nextCursor,
                  },
                }
              : parsed;
          await seedClientRead(url, { data }, session);
          setError(false);
          window.dispatchEvent(new Event('yazio:workouts-loaded'));
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
    [ownerId, date, url, refreshRead],
  );
  useEffect(() => {
    const effectGeneration = ++generation.current;
    inflight.current?.abort();
    inflight.current = null;
    lastAutomatic.current = 0;
    void Promise.resolve().then(async () => {
      if (generation.current !== effectGeneration) return;
      await refresh(undefined, true);
    });
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh(undefined, true);
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
    error: error || !!resource.error,
    busy,
    refresh,
    denied: resource.error === 'denied',
    loadMore: () => nativePage.nextCursor && refresh(nativePage.nextCursor),
  };
}
export function SyncSummary({
  sync,
}: {
  sync: ReturnType<typeof useTransformMateSync>;
}) {
  const online = useReadOnline();
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
      <Group justify="space-between" gap="xs">
        {sync.nativeRefresh.checkedAt && (
          <Text size="sm" c="dimmed">
            {m.checked}:{' '}
            {new Date(sync.nativeRefresh.checkedAt).toLocaleString('ru-RU')}
          </Text>
        )}
        <Button
          variant="subtle"
          size="compact-sm"
          mih={44}
          loading={sync.busy}
          disabled={!online}
          title={!online ? m.syncError : undefined}
          onClick={() => void sync.refresh()}
        >
          {m.syncRefresh}
        </Button>
      </Group>
      {sync.error && (
        <Alert color="red" role="alert">
          {m.syncError}
        </Alert>
      )}
    </Stack>
  );
}
export function WorkoutSync({
  item,
  representedExercises = [],
  showActual = true,
}: {
  item?: TransformMateSyncItem;
  representedExercises?: import('@/contracts/workouts').WorkoutExercise[];
  showActual?: boolean;
}) {
  if (!item || (!showActual && item.reason === 'not_configured')) return null;
  const unpublished =
    item.reason === 'unsupported' && item.remoteTrainingId === null;
  const statusColor =
    (item.status === 'started' && item.actual?.finished) ||
    item.status === 'synced'
      ? 'green'
      : item.status === 'error'
        ? 'red'
        : item.status === 'conflict' || item.status === 'unknown'
          ? 'orange'
          : 'gray';
  return (
    <Stack gap="xs">
      <Group>
        <Text fw={600}>{m.sync}</Text>
        <Badge
          variant={statusColor === 'gray' ? 'light' : undefined}
          c={statusColor === 'gray' ? 'dimmed' : undefined}
          color={statusColor}
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
          {item.actual.exercises
            .filter(
              (exercise) =>
                !representedExercises.some(
                  (planned) =>
                    planned.transformMate &&
                    planned.transformMate.occurrenceKey ===
                      exercise.occurrenceKey &&
                    planned.transformMate.exerciseId === exercise.exerciseId,
                ),
            )
            .map((exercise, index) => (
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
