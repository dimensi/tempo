'use client';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { ResourcePending } from '@/components/shared/read-resource-pending';
import { CommentsPanel } from '@/features/comments';
import { DiaryClient } from '@/features/nutrition';
import { useReadContext } from '@/lib/client-session';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
function useSelectedDate() {
  const params = useSearchParams();
  const selected = z.iso.date().safeParse(params.get('date'));
  return selected.success ? selected.data : browserToday();
}
export function DiaryPage() {
  const context = useReadContext();
  const date = useSelectedDate();
  const query = new URLSearchParams({
    ownerId: context.ownerId,
    from: date,
    to: date,
  });
  const day = useReadResource(
    readResources.diary(`/api/nutrition/days?${query}`),
  );
  const photos = useReadResource(
    readResources.photos(`/api/nutrition/photos?${query}`),
  );
  if (!day.data && day.error) return <ResourcePending {...day} />;
  return (
    <DiaryClient
      ownerId={context.ownerId}
      date={date}
      day={day.data?.[0] ?? null}
      photos={photos.data ?? []}
      canWrite={context.role === 'OWNER'}
      loading={!day.data}
      commentsSlot={
        day.data?.[0] ? (
          <CommentsPanel
            ownerId={context.ownerId}
            target={{ type: 'nutrition_day', id: date }}
          />
        ) : undefined
      }
    />
  );
}
