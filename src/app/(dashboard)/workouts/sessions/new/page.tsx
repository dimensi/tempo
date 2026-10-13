import { ResultsPage } from '@/app/(dashboard)/workouts/results-page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ResultsPage query={await searchParams} />;
}
