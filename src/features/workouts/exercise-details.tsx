'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Group, Skeleton, Stack, Text } from '@mantine/core';
import {
  transformMateExerciseInfoSchema,
  type TransformMateExerciseInfo,
} from '@/contracts/transformmate';
import { TeachingVideo } from './teaching-video';
import { workoutMessages as m } from './messages';

function LoadedExerciseDetails({
  ownerId,
  exerciseId,
  compactVideo = false,
}: {
  ownerId: string;
  exerciseId: number;
  compactVideo?: boolean;
}) {
  const [info, setInfo] = useState<TransformMateExerciseInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/workouts/transformmate/exercises/${exerciseId}?ownerId=${encodeURIComponent(ownerId)}`,
      { signal: controller.signal, cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        const detail = transformMateExerciseInfoSchema.parse(result.data);
        if (detail.id !== exerciseId) throw new Error();
        if (!controller.signal.aborted) setInfo(detail);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [ownerId, exerciseId]);
  if (failed)
    return (
      <Alert color="red" role="alert">
        {m.catalogError}
      </Alert>
    );
  if (!info) return <Skeleton height={44} aria-label={m.loading} />;
  return (
    <Stack gap="sm" data-testid={`exercise-details-${exerciseId}`}>
      {info.hasVideo && (
        <TeachingVideo
          compact={compactVideo}
          key={`${ownerId}-${exerciseId}`}
          poster={
            info.preview.coverage === 'absent'
              ? undefined
              : (info.preview.path ??
                `/api/workouts/transformmate/exercises/${exerciseId}/preview?ownerId=${encodeURIComponent(ownerId)}`)
          }
          src={`/api/workouts/transformmate/exercises/${exerciseId}/video?ownerId=${encodeURIComponent(ownerId)}`}
        />
      )}
      <Badge variant="outline" color="gray" c="dimmed">
        {m.catalogueSource}
      </Badge>
      {info.description && (
        <Text
          size="sm"
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {info.description}
        </Text>
      )}
      {info.muscleGroups.length > 0 && (
        <Group gap="xs">
          {info.muscleGroups.map((group) => (
            <Badge key={group.id} variant="light" color="gray">
              {group.name}
            </Badge>
          ))}
        </Group>
      )}
      {info.publicationCapability.state === 'unknown' && (
        <Text size="sm" c="dimmed">
          {m.publicationUnknown}
        </Text>
      )}
      {info.publicationCapability.state === 'unsupported' && (
        <Text size="sm" c="dimmed">
          {m.publicationUnsupported}
        </Text>
      )}
    </Stack>
  );
}

export function ExerciseDetails({
  ownerId,
  exerciseId,
  compactVideo,
}: {
  ownerId: string;
  exerciseId: number;
  compactVideo?: boolean;
}) {
  return (
    <LoadedExerciseDetails
      key={`${ownerId}:${exerciseId}`}
      compactVideo={compactVideo}
      ownerId={ownerId}
      exerciseId={exerciseId}
    />
  );
}
