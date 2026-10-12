import { DetailPage } from '../../../../detail-page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string; workoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = await params;
  return (
    <DetailPage
      resource={{
        kind: 'plan',
        planId: value.planId,
        workoutId: value.workoutId,
      }}
      query={await searchParams}
    />
  );
}
