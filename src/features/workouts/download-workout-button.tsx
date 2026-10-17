'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Progress, Stack, Text } from '@mantine/core';
import { IconCheck, IconDownload } from '@tabler/icons-react';
import type { ReadDescriptor } from '@/lib/read-descriptors';
import { useReadOnline } from '@/lib/use-read-online';
import { subscribeSessionReset } from '@/lib/offline-device';
import {
  downloadWorkout,
  readWorkoutDownload,
  type WorkoutDownload,
} from './workout-download';
import { workoutMessages as m } from './messages';

export function DownloadWorkoutButton({
  ownerId,
  workoutKey,
  signature,
  resources,
  exercises,
  blocked,
}: {
  ownerId: string;
  workoutKey: string;
  signature: string;
  resources: Pick<ReadDescriptor<unknown>, 'href'>[];
  exercises: { id: number; name: string }[];
  blocked: boolean;
}) {
  const online = useReadOnline();
  const request = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<WorkoutDownload | null>(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
    name: string;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void readWorkoutDownload(workoutKey, signature)
      .then((value) => {
        if (active) setSaved(value);
      })
      .catch(() => {});
    const stop = subscribeSessionReset(() => {
      request.current?.abort();
      setSaved(null);
    });
    return () => {
      active = false;
      request.current?.abort();
      stop();
    };
  }, [workoutKey, signature]);
  async function save() {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    setProgress(null);
    try {
      const value = await downloadWorkout({
        ownerId,
        key: workoutKey,
        signature,
        resources,
        exercises,
        signal: controller.signal,
        onProgress: (completed, total, name) =>
          setProgress({ completed, total, name }),
      });
      if (!controller.signal.aborted) setSaved(value);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button
          variant={saved ? 'subtle' : 'light'}
          mih={44}
          leftSection={
            saved ? <IconCheck size={18} /> : <IconDownload size={18} />
          }
          loading={busy}
          disabled={!online || busy || !!saved || blocked}
          onClick={() => void save()}
        >
          {busy
            ? m.downloadingWorkout
            : saved
              ? m.workoutDownloaded
              : m.downloadWorkout}
        </Button>
        {saved && (
          <Text size="sm" c="dimmed">
            {m.downloadedVideos}: {saved.files.length}
          </Text>
        )}
      </Group>
      {busy && (
        <div role="status" aria-live="polite">
          <Text size="sm">
            {progress
              ? `${progress.completed} / ${progress.total} · ${progress.name}`
              : m.downloadingData}
          </Text>
          <Progress
            mt={6}
            value={
              progress
                ? (100 * progress.completed) / Math.max(1, progress.total)
                : 0
            }
            aria-label={m.downloadProgress}
          />
        </div>
      )}
      {!online && !saved && (
        <Text size="sm" c="dimmed">
          {m.downloadNeedsNetwork}
        </Text>
      )}
      {blocked && (
        <Text size="sm" c="dimmed">
          {m.downloadSaveFirst}
        </Text>
      )}
      {failed && (
        <Alert color="orange" role="alert">
          {m.downloadFailed}
        </Alert>
      )}
      {saved?.missing.length ? (
        <Text size="sm" c="dimmed">
          {m.downloadNoVideo}: {saved.missing.join(', ')}
        </Text>
      ) : null}
    </Stack>
  );
}
