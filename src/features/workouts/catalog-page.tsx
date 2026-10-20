'use client';
import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/layout/page-header';
import { ExerciseBrowser } from './exercise-browser';
import { workoutMessages as m } from './messages';
export function CatalogPage({ ownerId }: { ownerId: string }) {
  return (
    <Stack>
      <PageHeader>{m.exerciseCatalog}</PageHeader>
      <ExerciseBrowser ownerId={ownerId} />
    </Stack>
  );
}
