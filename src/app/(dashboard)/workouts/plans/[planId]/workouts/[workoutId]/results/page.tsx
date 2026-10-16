import { loadResults } from '@/app/(dashboard)/workouts/results-data';
import { WorkoutResultsPage, workoutMessages as m } from '@/features/workouts';
import { Alert } from '@mantine/core';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string; workoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = await params;
  const data = await loadResults({
    planId: value.planId,
    workoutId: value.workoutId,
    query: await searchParams,
  });
  if (!data) return <Alert color="red">{m.noAccess}</Alert>;
  const { key, ...props } = data;
  return <WorkoutResultsPage key={key} {...props} />;
}
