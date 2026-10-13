import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Alert } from '@mantine/core';
import { z } from 'zod';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { listWorkouts } from '@/server/workouts';
import { WorkoutResultsPage, workoutMessages as m } from '@/features/workouts';
import type { ResultReturn } from '@/features/workouts';

export async function ResultsPage({
  sessionId,
  planId,
  workoutId,
  query,
}: {
  sessionId?: string;
  planId?: string;
  workoutId?: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (
    !ownerId ||
    !(await authorize(requestHeaders, 'workouts:log', ownerId)).ok
  )
    return <Alert color="red">{m.noAccess}</Alert>;
  const dateParsed = z.iso.date().safeParse(query.date);
  const date = dateParsed.success
    ? dateParsed.data
    : new Date().toLocaleDateString('en-CA');
  const returnParsed = z.iso.date().safeParse(query.returnDate);
  const returnDate = returnParsed.success ? returnParsed.data : date;
  const data = await listWorkouts(requestHeaders, ownerId);
  let existing = sessionId
    ? data.sessions.find((item) => item.id === sessionId)
    : undefined;
  if (sessionId && !existing) notFound();
  const plan = planId
    ? data.plans.find((item) => item.id === planId)
    : undefined;
  const workout = plan?.workouts.find((item) => item.id === workoutId);
  if (planId && (!plan || !workout)) notFound();
  if (!existing && plan && workout)
    existing = data.sessions
      .filter(
        (item) =>
          item.planId === plan.id && item.plannedWorkoutId === workout.id,
      )
      .at(-1);
  let destination: ResultReturn = { kind: 'day' };
  if (query.from === 'view' && plan && workout)
    destination = { kind: 'plan', planId: plan.id, workoutId: workout.id };
  else if (query.from === 'view' && existing)
    destination = { kind: 'session', id: existing.id };
  else if (
    query.from === 'plan' &&
    existing?.planId &&
    existing.plannedWorkoutId &&
    data.plans.some(
      (item) =>
        item.id === existing.planId &&
        item.workouts.some((entry) => entry.id === existing.plannedWorkoutId),
    )
  )
    destination = {
      kind: 'plan',
      planId: existing.planId,
      workoutId: existing.plannedWorkoutId,
    };
  return (
    <WorkoutResultsPage
      key={`${session.user.id}:${ownerId}:${sessionId ?? planId ?? 'new'}:${existing?.revision ?? plan?.revision ?? 0}:${workoutId ?? ''}:${date}:${returnDate}:${JSON.stringify(destination)}`}
      userId={session.user.id}
      ownerId={ownerId}
      date={date}
      returnDate={returnDate}
      destination={destination}
      existing={existing}
      planned={existing?.planSnapshot?.workout ?? workout}
      planId={existing ? undefined : plan?.id}
      planRevision={plan?.revision}
    />
  );
}
