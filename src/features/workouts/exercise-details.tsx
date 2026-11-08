'use client';
import { Alert, Button, Skeleton, Stack, Text } from '@mantine/core';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { TeachingVideo } from './teaching-video';
import { useExercisePreview } from './exercise-preview';
import { workoutMessages as m } from './messages';

import { exerciseHref, techniqueHref } from './transformmate-exercises';

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
  if (!info)
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
      {info.hasVideo ? (
        <TeachingVideo
          key={`${ownerId}:${exerciseId}`}
          autoPlay={autoPlay}
          compact={compactVideo}
          poster={preview?.src}
          src={techniqueHref(ownerId, exerciseId)}
        />
      ) : (
        <Text c="dimmed">{m.noTechnique}</Text>
      )}
      {info.description && (
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
