'use client';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { useReadContext } from '@/lib/client-session';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import type { readWorkoutDetails } from '@/server/workouts/details';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
function useSelectedDate() {
  const params = useSearchParams();
  const selected = z.iso.date().safeParse(params.get('date'));
  return selected.success ? selected.data : browserToday();
}
export function useWorkoutDetail(
  resource: Parameters<typeof readWorkoutDetails>[2],
) {
  const context = useReadContext();
  const date = useSelectedDate();
  const query = new URLSearchParams({ kind: resource.kind, date });
  if (resource.kind === 'plan') {
    query.set('planId', resource.planId);
    query.set('workoutId', resource.workoutId);
  } else query.set('id', String(resource.id));
  const read = useReadResource(
    readResources.workout(`/api/read/workout?${query}`),
  );
  return { context, date, read };
}
