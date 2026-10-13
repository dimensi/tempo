import { ResultsPage } from '@/app/(dashboard)/workouts/results-page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <ResultsPage sessionId={(await params).id} query={await searchParams} />
  );
}
