import type { readWorkoutDetails } from '@/server/workouts/details';
export function DetailPage(_props: {
  resource: Parameters<typeof readWorkoutDetails>[2];
  query: Record<string, string | string[] | undefined>;
}) {
  void _props;
  return null;
}
