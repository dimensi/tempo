import { ResultsPage } from '@/app/(dashboard)/workouts/results-page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string; workoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { planId, workoutId } = await params;
  return (
    <ResultsPage
      planId={planId}
      workoutId={workoutId}
      query={await searchParams}
    />
  );
}
