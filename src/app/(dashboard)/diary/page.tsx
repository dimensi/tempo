import { headers } from 'next/headers';
import { Alert, Stack, Title } from '@mantine/core';
import { DiaryClient, diaryMessages as m } from '@/features/nutrition';
import { CommentsPanel } from '@/features/comments';
import { diaryDateSchema } from '@/contracts/nutrition';
import { requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { getNutritionDay, listMealPhotos } from '@/server/nutrition';

export const metadata = { title: 'Дневник питания' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();
  const parsed = diaryDateSchema.safeParse((await searchParams).date);
  const date = parsed.success
    ? parsed.data
    : new Date().toISOString().slice(0, 10);
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId)
    return (
      <Stack>
        <Title order={1}>{m.title}</Title>
        <Alert>{m.denied}</Alert>
      </Stack>
    );
  const [day, photos] = await Promise.all([
    getNutritionDay(requestHeaders, ownerId, date),
    listMealPhotos(requestHeaders, ownerId, { from: date, to: date }),
  ]);
  return (
    <DiaryClient
      key={`${ownerId}:${date}`}
      ownerId={ownerId}
      date={date}
      day={day}
      photos={photos}
      canWrite={session.user.role === 'OWNER' && session.user.id === ownerId}
      commentsSlot={
        day ? (
          <CommentsPanel
            ownerId={ownerId}
            target={{ type: 'nutrition_day', id: date }}
          />
        ) : undefined
      }
    />
  );
}
