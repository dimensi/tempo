import { WorkoutDetailPage } from '../../../../detail-view';
export default async function Page({
  params,
}: {
  params: Promise<{ planId: string; workoutId: string }>;
}) {
  const value = await params;
  return (
    <WorkoutDetailPage
      resource={{
        kind: 'plan',
        planId: value.planId,
        workoutId: value.workoutId,
      }}
    />
  );
}
