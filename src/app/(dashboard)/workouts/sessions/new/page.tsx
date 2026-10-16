import { loadResults } from '@/app/(dashboard)/workouts/results-data';
import { WorkoutResultsPage, workoutMessages as m } from '@/features/workouts';
import { Alert } from '@mantine/core';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = await loadResults({ query: await searchParams });
  if (!data) return <Alert color="red">{m.noAccess}</Alert>;
  const { key, ...props } = data;
  return <WorkoutResultsPage key={key} {...props} />;
}
