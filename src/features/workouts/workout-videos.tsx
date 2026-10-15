'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  FileButton,
  Group,
  Progress,
  Stack,
  Text,
} from '@mantine/core';
import type { WorkoutSession } from '@/contracts/workouts';
import {
  VIDEO_PART_BYTES,
  type WorkoutVideo,
} from '@/contracts/workout-videos';
import { subscribeOfflineBlocked } from '@/lib/offline-device';
import { OfflineFile } from '@/components/shared/offline-file';
import { TeachingVideo } from './teaching-video';
import { compressWorkoutVideo } from './compress-video';
import { sendVideoPart } from './video-upload';
import { videoDraft, type VideoDraft } from '@/lib/workout-video-draft';
import { workoutMessages as m } from './messages';
export function WorkoutVideos({
  ownerId,
  session,
  canUpload,
}: {
  ownerId: string;
  session: WorkoutSession;
  canUpload: boolean;
}) {
  return (
    <Stack>
      <Text fw={600}>{m.ownVideos}</Text>
      {session.exercises.map(
        (exercise) =>
          exercise.id && (
            <ExerciseVideos
              key={exercise.id}
              ownerId={ownerId}
              sessionId={session.id}
              exerciseId={exercise.id}
              name={exercise.name}
              canUpload={canUpload && session.status === 'completed'}
            />
          ),
      )}
    </Stack>
  );
}
function ExerciseVideos({
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
  const [draft, setDraft] = useState<VideoDraft>();
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState<'compress' | 'upload' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [ready, setReady] = useState(false);
  const [retained, setRetained] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const draftKey = `${ownerId}:${sessionId}:${exerciseId}`;
  const base = `/api/workouts/videos`;
  const query = `?ownerId=${encodeURIComponent(ownerId)}`;
  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`${base}${path}${query}`, {
      ...init,
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        if (mounted.current) {
          setDenied(true);
          setDraft(undefined);
          setVideos([]);
        }
        void videoDraft(draftKey, 'delete').catch(() => {});
        throw new Error(m.noAccess);
      }
      throw new Error(
        response.status === 409 ? m.conflict : m.videoUploadError,
      );
    }
    return (await response.json()).data;
  }
  async function refresh(signal?: AbortSignal) {
    const response = await fetch(`${base}${query}&sessionId=${sessionId}`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setDenied(true);
        setDraft(undefined);
        setVideos([]);
        void videoDraft(draftKey, 'delete').catch(() => {});
      }
      throw new Error(m.noAccess);
    }
    const rows: WorkoutVideo[] = (await response.json()).data;
    if (mounted.current)
      setVideos(rows.filter((row) => row.exerciseId === exerciseId));
    return rows;
  }
  useEffect(() => {
    mounted.current = true;
    const check = new AbortController();
    void Promise.resolve()
      .then(() => refresh(check.signal))
      .then(async () => {
        if (canUpload && !check.signal.aborted) {
          const saved = await videoDraft(draftKey, 'read').catch(
            () => undefined,
          );
          if (!check.signal.aborted) setDraft(saved);
        }
        if (!check.signal.aborted) setReady(true);
      })
      .catch(() => {
        if (!check.signal.aborted) setError(m.videoLoadError);
      });
    const pause = () => {
      if (document.hidden) controller.current?.abort();
      else void refresh().catch(() => {});
    };
    const unsubscribe = subscribeOfflineBlocked(() => {
      // Offline-cache disablement alone is not loss of workout permission.
      // Recheck server authority before concealing recordings.
      void refresh().catch(() => {});
    });
    document.addEventListener('visibilitychange', pause);
    return () => {
      unsubscribe();
      mounted.current = false;
      check.abort();
      controller.current?.abort();
      document.removeEventListener('visibilitychange', pause);
    };
    // A fresh mount revalidates permission before reading local media.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, canUpload]);
  useEffect(() => {
    if (!draft) {
      // Object URLs are external resources synchronized to the current Blob.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(draft.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);
  async function retain(value: VideoDraft) {
    try {
      await videoDraft(draftKey, 'write', value);
      setRetained(true);
    } catch {
      setRetained(false);
    }
  }
  async function select(file: File | null) {
    if (!file) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('compress');
    setError('');
    setProgress(0);
    try {
      const value = await compressWorkoutVideo(file, abort.signal, (n) => {
        if (mounted.current) setProgress(n * 100);
      });
      if (!mounted.current) return;
      setDraft(value);
      await retain(value);
    } catch (cause) {
      if (mounted.current)
        setError(
          abort.signal.aborted
            ? m.videoPaused
            : cause instanceof Error
              ? cause.message
              : m.videoUnsupported,
        );
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  async function upload() {
    if (!draft) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('upload');
    setError('');
    setProgress(0);
    let pending = draft;
    try {
      // Persist identity before POST: a lost response must not create another upload.
      const uploadId = pending.uploadId ?? crypto.randomUUID();
      pending = { ...pending, uploadId };
      setDraft(pending);
      await retain(pending);
      const rows = await refresh(abort.signal);
      let row: WorkoutVideo | undefined = rows.find(
        (item) => item.id === pending.uploadId,
      );
      if (!row)
        row = await call('', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uploadId,
          },
          body: JSON.stringify({
            sessionId,
            exerciseId,
            size: pending.blob.size,
            duration: pending.duration,
          }),
          signal: abort.signal,
        });
      if (!row) throw new Error(m.videoUploadError);
      pending = { ...pending, uploadId: row.id };
      setDraft(pending);
      await retain(pending);
      const count = Math.ceil(pending.blob.size / VIDEO_PART_BYTES);
      let acknowledged = row.parts.reduce(
        (sum, part) =>
          sum +
          Math.min(
            VIDEO_PART_BYTES,
            pending.blob.size - part * VIDEO_PART_BYTES,
          ),
        0,
      );
      if (row.state !== 'ready')
        for (let part = 0; part < count; part++) {
          if (row.parts.includes(part)) continue;
          const blob = pending.blob.slice(
            part * VIDEO_PART_BYTES,
            (part + 1) * VIDEO_PART_BYTES,
          );
          await sendVideoPart(
            `${base}/${row.id}/parts/${part}${query}`,
            blob,
            abort.signal,
            (bytes) => {
              if (mounted.current)
                setProgress(((acknowledged + bytes) / pending.blob.size) * 100);
            },
          );
          acknowledged += blob.size;
        }
      await call(`/${row.id}/finalize`, {
        method: 'POST',
        signal: abort.signal,
      });
      await videoDraft(draftKey, 'delete').catch(() => {});
      if (mounted.current) {
        setDraft(undefined);
        await refresh(abort.signal);
      }
    } catch (cause) {
      if (mounted.current) {
        const message = abort.signal.aborted
          ? m.videoPaused
          : cause instanceof Error
            ? cause.message
            : m.videoUploadError;
        setError(message);
        if (message === m.noAccess) {
          setDenied(true);
          setDraft(undefined);
          void videoDraft(draftKey, 'delete').catch(() => {});
        }
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  async function remove(id?: string) {
    setError('');
    try {
      if (id) await call(`/${id}`, { method: 'DELETE' });
      if (draft?.uploadId === id || !id) {
        setDraft(undefined);
        await videoDraft(draftKey, 'delete').catch(() => {});
      }
      await refresh();
    } catch {
      setError(m.videoUploadError);
    }
  }
  if (denied) return <Alert color="red">{m.noAccess}</Alert>;
  return (
    <Stack gap="sm" component="section" aria-label={`${m.ownVideos}: ${name}`}>
      <Text fw={500}>{name}</Text>
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
            <OfflineFile
              id={`video:${row.id}`}
              label={name}
              kind="video"
              size={row.size}
              href={`${base}/${row.id}/playback?ownerId=${encodeURIComponent(ownerId)}`}
            />
            {canUpload && (
              <Button
                variant="subtle"
                color="red"
                mih={44}
                disabled={!!busy}
                onClick={() => void remove(row.id)}
              >
                {m.videoDelete}
              </Button>
            )}
          </Stack>
        ))}
      {canUpload && ready && (
        <>
          <Text size="sm" c="dimmed">
            {m.videoHelp}
          </Text>
          {!draft && (
            <FileButton
              onChange={(file) => void select(file)}
              accept="video/*,.mov,.mp4"
            >
              {(props) => (
                <Button {...props} mih={44} disabled={!!busy}>
                  {m.videoSelect}
                </Button>
              )}
            </FileButton>
          )}
          {draft && preview && (
            <>
              <Text size="sm">
                {m.videoPreview} · {(draft.blob.size / 1024 / 1024).toFixed(1)}{' '}
                МиБ
              </Text>
              <TeachingVideo
                src={preview}
                label={`${m.videoPreview}: ${name}`}
                compact
              />
              <Group>
                <Button
                  mih={44}
                  disabled={!!busy}
                  onClick={() => void upload()}
                >
                  {draft.uploadId ? m.videoResume : m.videoUpload}
                </Button>
                <Button
                  mih={44}
                  variant="subtle"
                  color="red"
                  disabled={!!busy}
                  onClick={() => void remove(draft.uploadId)}
                >
                  {m.videoDiscard}
                </Button>
              </Group>
              <Text size="sm" c="dimmed">
                {retained ? m.videoLocalDraft : m.videoNotRetained}
              </Text>
            </>
          )}
          {videos
            .filter(
              (row) => row.state === 'uploading' && row.id !== draft?.uploadId,
            )
            .map((row) => (
              <Group key={row.id}>
                <Text size="sm">{m.videoIncomplete}</Text>
                <Button
                  mih={44}
                  variant="subtle"
                  color="red"
                  disabled={!!busy}
                  onClick={() => void remove(row.id)}
                >
                  {m.videoDiscard}
                </Button>
              </Group>
            ))}
          {busy && (
            <>
              <Text size="sm">
                {busy === 'compress' ? m.videoCompressing : m.videoUploading}
              </Text>
              <Progress value={progress} aria-label={m.videoProgress} />
              <Button
                mih={44}
                variant="default"
                onClick={() => controller.current?.abort()}
              >
                {m.videoPause}
              </Button>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
