import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Alert } from '@mantine/core';
import { z } from 'zod';
import { requireSession, authorize } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { listWorkouts } from '@/server/workouts';
import { WorkoutEditorPage, workoutMessages as m } from '@/features/workouts';

export async function EditorPage({
  planId,
  query,
}: {
  planId?: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (
    !ownerId ||
    !(await authorize(requestHeaders, 'workouts:plan', ownerId)).ok
  )
    return <Alert color="red">{m.noAccess}</Alert>;
  const dateResult = z.iso.date().safeParse(query.date);
  const date = dateResult.success
    ? dateResult.data
    : new Date().toLocaleDateString('en-CA');
  const returnResult = z.iso.date().safeParse(query.returnDate);
  const returnDate = returnResult.success ? returnResult.data : date;
  const copyId = typeof query.copy === 'string' ? query.copy : undefined;
  const id = planId ?? copyId;
  const plan = id
    ? (await listWorkouts(requestHeaders, ownerId)).plans.find(
        (item) => item.id === id,
      )
    : undefined;
  if (id && !plan) notFound();
  const workoutId =
    typeof query.workout === 'string' ? query.workout : undefined;
  if (workoutId && !plan?.workouts.some((item) => item.id === workoutId))
    notFound();
  if (copyId && !workoutId) notFound();
  return (
    <WorkoutEditorPage
      key={`${session.user.id}:${ownerId}:${plan?.id ?? 'new'}:${plan?.revision ?? 0}:${workoutId ?? ''}:${date}:${copyId ?? ''}`}
      canLog={session.user.role === 'OWNER'}
      userId={session.user.id}
      ownerId={ownerId}
      date={date}
      returnDate={returnDate}
      plan={plan}
      workoutId={workoutId}
      copying={Boolean(copyId)}
      returnToView={query.from === 'view' && Boolean(plan && workoutId)}
    />
  );
}
