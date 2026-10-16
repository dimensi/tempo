import type { readWorkoutDetails } from '@/server/workouts/details';
import { WorkoutDetailPage } from '../read-pages';
export function DetailPage({
  resource,
}: {
  resource: Parameters<typeof readWorkoutDetails>[2];
  query: Record<string, string | string[] | undefined>;
}) {
  return <WorkoutDetailPage resource={resource} />;
}
