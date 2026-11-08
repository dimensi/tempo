'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Group, Skeleton, Stack } from '@mantine/core';
import { PageHeader } from '@/components/layout/page-header';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { ExerciseDetails } from './exercise-details';
import { ExerciseTechniqueEditor } from './exercise-technique-editor';
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
  const [editingScope, setEditingScope] = useState<string>();
  const [visitedScope, setVisitedScope] = useState<string>();
  const read = useReadResource(
    readResources.exercise(
      ownerId ? exerciseHref(ownerId, exerciseId, true) : undefined,
    ),
  );
  const info = read.data;
  const scope = info?.technique?.scope;
  const editing = Boolean(scope && editingScope === scope);
  return (
    <Stack maw={800} mx="auto" w="100%">
      <PageHeader>{info?.name ?? m.exercisePage}</PageHeader>
      <Group justify="space-between" gap="xs">
        <Button
          component={Link}
          href="/workouts/catalog"
          variant="subtle"
          mih={44}
        >
          {m.returnToCatalog}
        </Button>
        {scope && !editing && (
          <Button
            onClick={() => {
              setEditingScope(scope);
              setVisitedScope(scope);
            }}
            mih={44}
          >
            {m.editTechnique}
          </Button>
        )}
      </Group>
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
          {scope && visitedScope === scope && (
            <ExerciseTechniqueEditor
              key={scope}
              ownerId={ownerId}
              exerciseId={exerciseId}
              scope={scope}
              opened={editing}
              close={() => setEditingScope(undefined)}
            />
          )}
          <ExerciseDetails
            ownerId={ownerId}
            exerciseId={exerciseId}
            verifyOwnership
          />
          <ExerciseShare exerciseId={exerciseId} name={info.name} />
        </>
      )}
    </Stack>
  );
}
