import { loadEditor } from '@/app/(dashboard)/workouts/editor-data';
import { WorkoutEditorPage, workoutMessages as m } from '@/features/workouts';
import { Alert } from '@mantine/core';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = await loadEditor({ query: await searchParams });
  if (!data) return <Alert color="red">{m.noAccess}</Alert>;
  const { key, ...props } = data;
  return <WorkoutEditorPage key={key} {...props} />;
}
