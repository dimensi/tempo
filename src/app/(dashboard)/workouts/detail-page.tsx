import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Alert } from '@mantine/core';
import { z } from 'zod';
import { requireSession, authorize } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { readWorkoutDetails } from '@/server/workouts/details';
import { workoutMessages as m } from '@/features/workouts';
import { WorkoutDetailWithComments } from './with-comments';

export async function DetailPage({
  resource,
  query,
}: {
  resource: Parameters<typeof readWorkoutDetails>[2];
  query: Record<string, string | string[] | undefined>;
}) {
  if (
    resource.kind === 'native' &&
    (!Number.isSafeInteger(resource.id) || resource.id <= 0)
  )
    notFound();
  const session = await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (
    !ownerId ||
    !(await authorize(requestHeaders, 'workouts:read', ownerId)).ok
  )
    return <Alert color="red">{m.noAccess}</Alert>;
  const parsed = z.iso.date().safeParse(query.date);
  const date = parsed.success
    ? parsed.data
    : new Date().toLocaleDateString('en-CA');
  const detail = await readWorkoutDetails(
    requestHeaders,
    ownerId,
    resource,
    date,
  );
  if (!detail) notFound();
  return (
    <WorkoutDetailWithComments
      key={`${session.user.id}:${ownerId}:${JSON.stringify(resource)}`}
      ownerId={ownerId}
      canLog={session.user.role === 'OWNER'}
      date={date}
      detail={detail}
    />
  );
}
