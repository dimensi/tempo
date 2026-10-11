import { DiaryView } from '@/features/nutrition';
import { diaryDateSchema } from '@/contracts/nutrition';
import { requireSession } from '@/server/auth/guards';
export const metadata = { title: 'Дневник питания' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireSession();
  const parsed = diaryDateSchema.safeParse((await searchParams).date);
  const date = parsed.success
    ? parsed.data
    : new Date().toISOString().slice(0, 10);
  // Persistence and authorized photo APIs are connected by the coordinator.
  return <DiaryView key={date} date={date} day={null} />;
}
