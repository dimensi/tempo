'use client';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { ResourcePending } from '@/components/shared/read-resource-pending';
import { CommentsPanel } from '@/features/comments';
import { DiaryClient } from '@/features/nutrition';
import { useReadContext } from '@/lib/client-session';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { useNutritionSyncStatus } from '@/lib/use-nutrition-sync-status';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
function useSelectedDate() {
  const params = useSearchParams();
  const selected = z.iso.date().safeParse(params.get('date'));
  return selected.success ? selected.data : browserToday();
}
export default function Page() {
  const context = useReadContext();
  const owner = context.role === 'OWNER';
  const sync = useNutritionSyncStatus(owner);
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
  return (
    <DiaryClient
      ownerId={context.ownerId}
      date={date}
      day={day.data?.[0] ?? null}
      photos={photos.data ?? []}
      canWrite={owner}
      loading={day.data === undefined}
      syncingPhotos={sync?.activity?.photos.includes(date) ?? false}
      photoSyncFailed={
        !sync?.activity && !!sync?.last.photoFailedDates.includes(date)
      }
      unavailableSlot={
        day.data === undefined ? <ResourcePending {...day} /> : undefined
      }
      photosPendingSlot={
        photos.data === undefined ? <ResourcePending {...photos} /> : undefined
      }
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
