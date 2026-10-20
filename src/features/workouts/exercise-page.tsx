'use client';
import Link from 'next/link';
import { Alert, Badge, Button, Group, Skeleton, Stack } from '@mantine/core';
import { PageHeader } from '@/components/layout/page-header';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { ExerciseDetails } from './exercise-details';
import { ExerciseShare } from './exercise-share';
import { exerciseHref } from './transformmate-exercises';
import { workoutMessages as m } from './messages';

export function ExercisePage({
  ownerId,
  exerciseId,
}: {
  ownerId: string;
  exerciseId: number;
}) {
  const read = useReadResource(
    readResources.exercise(
      ownerId ? exerciseHref(ownerId, exerciseId) : undefined,
    ),
  );
  const info = read.data;
  return (
    <Stack maw={800} mx="auto" w="100%">
      <PageHeader>{info?.name ?? m.exercisePage}</PageHeader>
      <Button
        component={Link}
        href="/workouts/catalog"
        variant="subtle"
        mih={44}
        w="fit-content"
      >
        {m.returnToCatalog}
      </Button>
      {(!ownerId || read.error) && (
        <Alert color="orange" role="alert">
          {!ownerId || read.error === 'denied'
            ? m.noAccess
            : read.error === 'not-found'
              ? m.exerciseNotFound
              : m.exerciseUnavailable}
          {ownerId && (
            <Button variant="subtle" onClick={() => void read.refresh()}>
              {m.refresh}
            </Button>
          )}
        </Alert>
      )}
      {!info && ownerId && !read.error && (
        <Skeleton height={240} aria-label={m.loading} />
      )}
      {info && (
        <>
          <Group gap="xs">
            {info.muscleGroups.map((group) => (
              <Badge key={group.id} color="gray" variant="light">
                {group.name}
              </Badge>
            ))}
          </Group>
          <ExerciseDetails ownerId={ownerId} exerciseId={exerciseId} />
          <ExerciseShare exerciseId={exerciseId} name={info.name} />
        </>
      )}
    </Stack>
  );
}
