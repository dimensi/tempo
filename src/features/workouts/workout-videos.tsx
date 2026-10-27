'use client';
import type { WorkoutVideo } from '@/contracts/workout-videos';
import { apiFetch } from '@/lib/api-client';
import { subscribeSessionReset } from '@/lib/offline-device';
import { sessionGeneration } from '@/lib/session-state';
import { Alert, Button, Stack } from '@mantine/core';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { workoutMessages as m } from './messages';
import { TeachingVideo } from './teaching-video';
const VideoQueue = dynamic(() => import('./video-queue'), { ssr: false });
export function ExerciseVideos({
  ownerId,
  sessionId,
  exerciseId,
  name,
  canUpload,
}: {
  ownerId: string;
  sessionId: string;
  exerciseId: string;
  name: string;
  canUpload: boolean;
}) {
  const [videos, setVideos] = useState<WorkoutVideo[]>([]);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(sessionGeneration);
  const mounted = useRef(false);
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
      setVideos(rows.filter((row) => row.exerciseId === exerciseId));
      setError('');
    }
    return rows;
  }
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    const reset = () => {
      epoch.current++;
      if (generation !== sessionGeneration()) {
        setGeneration(sessionGeneration());
        setVideos([]);
      }
      void refresh(abort.signal).catch(() => {});
    };
    void refresh(abort.signal).catch(() => {
      if (!abort.signal.aborted) setError(m.videoLoadError);
    });
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
  async function remove(id: string) {
    const session = sessionGeneration();
    try {
      const response = await apiFetch(`${base}/${id}${query}`, {
        method: 'DELETE',
      });
      if (!response.ok)
        throw new Error(
          response.status === 403 ? m.forbidden : m.videoUploadError,
        );
      if (mounted.current && session === sessionGeneration()) {
        setVideos((rows) => rows.filter((row) => row.id !== id));
        void refresh().catch(() => {});
      }
    } catch (cause) {
      if (mounted.current && session === sessionGeneration())
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
      {videos
        .filter((row) => row.state === 'ready')
        .map((row) => (
          <Stack key={row.id}>
            <TeachingVideo
              src={`${base}/${row.id}/playback${query}`}
              label={`${m.ownVideos}: ${name}`}
              compact
            />
            {canUpload && (
              <Button
                variant="subtle"
                color="red"
                mih={44}
                onClick={() => void remove(row.id)}
              >
                {m.videoDelete}
              </Button>
            )}
          </Stack>
        ))}
      {canUpload && (
        <VideoQueue
          key={`${ownerId}:${sessionId}:${exerciseId}:${generation}`}
          ownerId={ownerId}
          sessionId={sessionId}
          exerciseId={exerciseId}
          videos={videos}
          refresh={refresh}
          onUploaded={(video) => {
            epoch.current++;
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
