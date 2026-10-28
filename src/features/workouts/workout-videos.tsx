'use client';
import type { WorkoutVideo } from '@/contracts/workout-videos';
import { apiFetch } from '@/lib/api-client';
import { subscribeSessionReset } from '@/lib/offline-device';
import { sessionGeneration } from '@/lib/session-state';
import { Alert, Button, Group, Progress, Stack, Text } from '@mantine/core';
import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { createPortal } from 'react-dom';
import classes from './workout-videos.module.css';
import { workoutMessages as m } from './messages';
import { TeachingVideo } from './teaching-video';
const VideoQueue = dynamic(() => import('./video-queue'), { ssr: false });
// Keep FilePond laid out even while its dialog is hidden: its scheduler flushes
// queued work through the view loop. Moving a stable portal host preserves jobs.
function PersistentVideoQueue({
  visible,
  ...props
}: ComponentProps<typeof VideoQueue> & { visible: boolean }) {
  const anchor = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    anchor.current = node;
    if (!node) return;
    const container = document.createElement('div');
    hostRef.current = container;
    setHost(container);
    return () => {
      hostRef.current = null;
      container.remove();
    };
  }, []);
  useLayoutEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    container.className = visible ? '' : (classes.backgroundQueue ?? '');
    container.inert = !visible;
    if (visible) container.removeAttribute('aria-hidden');
    else container.setAttribute('aria-hidden', 'true');
    (visible ? anchor.current : document.body)?.appendChild(container);
  }, [host, visible]);
  return (
    <>
      <div ref={attach} />
      {host && createPortal(<VideoQueue {...props} />, host)}
    </>
  );
}
export function ExerciseVideos({
  ownerId,
  sessionId,
  exerciseId,
  name,
  canUpload,
  visible = true,
  onVideosChange,
}: {
  ownerId: string;
  sessionId: string;
  exerciseId: string;
  name: string;
  canUpload: boolean;
  visible?: boolean;
  onVideosChange?: (exerciseId: string, hasVideos: boolean) => void;
}) {
  const [videos, setVideos] = useState<WorkoutVideo[]>([]);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(sessionGeneration);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const epoch = useRef(0);
  const base = '/api/workouts/videos';
  const query = `?ownerId=${encodeURIComponent(ownerId)}`;
  async function refresh(signal?: AbortSignal) {
    const token = epoch.current,
      session = sessionGeneration();
    const response = await apiFetch(`${base}${query}&sessionId=${sessionId}`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(m.videoLoadError);
    const rows: WorkoutVideo[] = (await response.json()).data;
    if (
      mounted.current &&
      token === epoch.current &&
      session === sessionGeneration()
    ) {
      loaded.current = true;
      setVideos(rows.filter((row) => row.exerciseId === exerciseId));
      setError('');
    }
    return rows;
  }
  useEffect(() => {
    mounted.current = true;
    loaded.current = false;
    const abort = new AbortController();
    const reset = () => {
      epoch.current++;
      if (generation !== sessionGeneration()) {
        setGeneration(sessionGeneration());
        setVideos([]);
      }
      void refresh(abort.signal).catch(() => {});
    };
    const stop = subscribeSessionReset(reset);
    const cleanup = () => {
      mounted.current = false;
      epoch.current++;
      abort.abort();
      stop();
    };
    return cleanup;
    // Each scope has its own recordings and request generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, sessionId, exerciseId]);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    const token = epoch.current;
    const session = sessionGeneration();
    void refresh(abort.signal).catch(() => {
      if (
        !abort.signal.aborted &&
        token === epoch.current &&
        session === sessionGeneration()
      )
        setError(m.videoLoadError);
    });
    return () => abort.abort();
    // Reopening refreshes the list without restarting the scoped upload queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ownerId, sessionId, exerciseId]);
  const processing = videos.some((row) => row.state === 'processing');
  useEffect(() => {
    if (!processing) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(() => {
      if (document.hidden || pending) return;
      pending = true;
      void refresh(controller.signal)
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
    // Poll only while a server job is active in this scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing, ownerId, sessionId, exerciseId]);
  async function retry(id: string) {
    const token = epoch.current,
      session = sessionGeneration();
    try {
      const response = await apiFetch(`${base}/${id}/finalize${query}`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(m.videoUploadError);
      const row: WorkoutVideo = (await response.json()).data;
      if (
        mounted.current &&
        token === epoch.current &&
        session === sessionGeneration()
      ) {
        epoch.current++;
        setVideos((rows) =>
          rows.map((video) => (video.id === id ? row : video)),
        );
        setError('');
      }
    } catch {
      if (
        mounted.current &&
        token === epoch.current &&
        session === sessionGeneration()
      )
        setError(m.videoUploadError);
    }
  }
  useEffect(() => {
    if (loaded.current && generation === sessionGeneration()) {
      onVideosChange?.(
        exerciseId,
        videos.some(
          (row) => row.exerciseId === exerciseId && row.state !== 'uploading',
        ),
      );
    }
  }, [videos, exerciseId, generation, onVideosChange]);
  async function remove(id: string) {
    const token = epoch.current,
      session = sessionGeneration();
    try {
      const response = await apiFetch(`${base}/${id}${query}`, {
        method: 'DELETE',
      });
      if (!response.ok)
        throw new Error(
          response.status === 403 ? m.forbidden : m.videoUploadError,
        );
      if (
        mounted.current &&
        token === epoch.current &&
        session === sessionGeneration()
      ) {
        epoch.current++;
        setVideos((rows) => rows.filter((row) => row.id !== id));
        void refresh().catch(() => {});
      }
    } catch (cause) {
      if (
        mounted.current &&
        token === epoch.current &&
        session === sessionGeneration()
      )
        setError(
          cause instanceof Error && cause.message === m.forbidden
            ? m.forbidden
            : m.videoUploadError,
        );
    }
  }
  if (generation !== sessionGeneration()) return null;
  return (
    <Stack gap="sm" component="section" aria-label={`${m.ownVideos}: ${name}`}>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {visible &&
        videos
          .filter((row) => row.state !== 'uploading')
          .map((row) => (
            <Stack key={row.id}>
              <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                {row.name || name}
              </Text>
              <Text
                component="time"
                dateTime={new Date(
                  row.recordedAt ?? row.createdAt,
                ).toISOString()}
                size="sm"
                c="dimmed"
              >
                {row.recordedAt === null ? m.videoAddedAt : m.videoRecordedAt}:{' '}
                {new Date(row.recordedAt ?? row.createdAt).toLocaleString(
                  'ru-RU',
                )}
              </Text>
              {row.state === 'ready' && (
                <TeachingVideo
                  src={`${base}/${row.id}/playback${query}`}
                  label={`${m.ownVideos}: ${name}`}
                  compact
                />
              )}
              {row.state === 'processing' && (
                <Stack gap={4}>
                  <Text size="sm">
                    {m.videoProcessing} {Math.round(row.progress * 100)}%
                  </Text>
                  <Progress
                    value={row.progress * 100}
                    aria-label={m.videoProgress}
                  />
                </Stack>
              )}
              {row.state === 'failed' && (
                <Alert color="red">
                  {row.error === 'invalid'
                    ? m.videoInvalid
                    : m.videoProcessingFailed}
                </Alert>
              )}
              {canUpload && (
                <Group>
                  {row.state === 'failed' && (
                    <Button
                      variant="default"
                      mih={44}
                      onClick={() => void retry(row.id)}
                    >
                      {m.videoRetryShort}
                    </Button>
                  )}
                  <Button
                    variant="subtle"
                    color="red"
                    mih={44}
                    onClick={() => void remove(row.id)}
                  >
                    {m.videoDelete}
                  </Button>
                </Group>
              )}
            </Stack>
          ))}
      {canUpload && (
        <PersistentVideoQueue
          visible={visible}
          key={`${ownerId}:${sessionId}:${exerciseId}:${generation}`}
          ownerId={ownerId}
          sessionId={sessionId}
          exerciseId={exerciseId}
          videos={videos}
          refresh={refresh}
          onRemoved={(id) => {
            epoch.current++;
            setVideos((rows) => rows.filter((row) => row.id !== id));
          }}
          onUploaded={(video) => {
            epoch.current++;
            loaded.current = true;
            setVideos((rows) => [
              ...rows.filter((row) => row.id !== video.id),
              video,
            ]);
          }}
        />
      )}
    </Stack>
  );
}
