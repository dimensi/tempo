import { notFound } from 'next/navigation';
import { ExercisePage } from '@/features/workouts';
import { exerciseReturnTo } from '@/lib/exercise-link';
import { readContext } from '@/server/read-context';
import { headers } from 'next/headers';
import { workoutMessages as m } from '@/features/workouts';
export const metadata = { title: m.exercisePage };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!exerciseReturnTo(`/workouts/catalog/${id}`)) notFound();
  const context = await readContext(await headers());
  return (
    <ExercisePage ownerId={context?.ownerId ?? ''} exerciseId={Number(id)} />
  );
}
