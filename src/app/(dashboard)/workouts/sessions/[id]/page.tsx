import { WorkoutDetailPage } from '../../detail-view';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const value = await params;
  return <WorkoutDetailPage resource={{ kind: 'session', id: value.id }} />;
}
