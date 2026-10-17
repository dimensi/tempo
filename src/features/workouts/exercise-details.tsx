'use client';
import { Alert, Button, Skeleton, Stack, Text } from '@mantine/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { savedFiles } from '@/lib/saved-files';
import { TeachingVideo } from './teaching-video';
import { useExercisePreview } from './exercise-preview';
import { workoutMessages as m } from './messages';

import { exerciseHref, techniqueHref } from './transformmate-exercises';

export function useSavedTechnique(id: number) {
  const state = useSyncExternalStore(
    savedFiles.subscribe,
    savedFiles.getSnapshot,
    savedFiles.getServerSnapshot,
  );
  const file = state.files.find((item) => item.id === `exercise-video:${id}`);
  const [resource, setResource] = useState<{ bytes: Blob; url: string } | null>(
    null,
  );
  useEffect(() => {
    void savedFiles.load().catch(() => {});
  }, []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file.bytes);
    const timer = setTimeout(() => setResource({ bytes: file.bytes, url }), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return file?.bytes === resource?.bytes ? resource?.url : undefined;
}

export function ExerciseDetails({
  ownerId,
  exerciseId,
  compactVideo = false,
  autoPlay = false,
}: {
  ownerId: string;
  exerciseId: number;
  compactVideo?: boolean;
  autoPlay?: boolean;
}) {
  const read = useReadResource(
    readResources.exercise(exerciseHref(ownerId, exerciseId)),
  );
  const info = read.data;
  const preview = useExercisePreview(ownerId, info ?? null);
  const saved = useSavedTechnique(exerciseId);
  if (!info && !saved)
    return read.error ? (
      <Alert color="orange">
        {m.catalogError}
        <Button variant="subtle" onClick={() => void read.refresh()}>
          {m.refresh}
        </Button>
      </Alert>
    ) : (
      <Skeleton height={240} aria-label={m.loading} />
    );
  return (
    <Stack gap="md" data-testid={`exercise-details-${exerciseId}`}>
      {saved || info?.hasVideo ? (
        <TeachingVideo
          key={saved ?? `${ownerId}:${exerciseId}`}
          autoPlay={autoPlay}
          compact={compactVideo}
          poster={preview?.src}
          src={saved ?? techniqueHref(ownerId, exerciseId)}
        />
      ) : (
        <Text c="dimmed">{m.noTechnique}</Text>
      )}
      {info?.description && (
        <Text
          size="sm"
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {info.description}
        </Text>
      )}
    </Stack>
  );
}
