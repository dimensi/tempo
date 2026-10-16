import { loadResults } from '@/app/(dashboard)/workouts/results-data';
import { WorkoutResultsPage, workoutMessages as m } from '@/features/workouts';
import { Alert } from '@mantine/core';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = await params;
  const data = await loadResults({
    sessionId: value.id,
    query: await searchParams,
  });
  if (!data) return <Alert color="red">{m.noAccess}</Alert>;
  const { key, ...props } = data;
  return <WorkoutResultsPage key={key} {...props} />;
}
