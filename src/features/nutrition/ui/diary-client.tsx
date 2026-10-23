'use client';

import { browserToday } from '@/components/shared/date-navigation-dates';
import { diaryDateSchema, type SafeMealPhotoView } from '@/contracts/nutrition';
import { revalidateVisibleReads } from '@/lib/client-read';
import { useReadOnline } from '@/lib/use-read-online';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Stack } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { DayNavigation } from './day-navigation';
import { DayRefreshControl } from './day-refresh-control';
import { DiaryView, type DiaryViewProps } from './diary-view';
import { createPhotoActions, diaryPhotos } from './photo-actions';

export interface DiaryClientProps extends Omit<
  DiaryViewProps,
  'photos' | 'photoActions'
> {
  ownerId: string;
  photos: SafeMealPhotoView[];
  canWrite: boolean;
  loading?: boolean;
}

export function DiaryClient({
  ownerId,
  photos,
  canWrite,
  loading = false,
  ...props
}: DiaryClientProps) {
  const goals = useReadResource(
    readResources.goals(`/api/health/goals?date=${props.date}`),
  );
  const router = useRouter();
  const online = useReadOnline();
  const params = useSearchParams();
  const hasDate =
    params.getAll('date').length === 1 &&
    diaryDateSchema.safeParse(params.get('date')).success;
  useEffect(() => {
    if (!hasDate) {
      router.replace(`/diary?date=${browserToday()}`, { scroll: false });
    }
  }, [hasDate, router]);
  // A date-less server request defaults to UTC. Do not flash that day's content
  // before the browser has resolved its own calendar date.
  if (!hasDate) return null;
  return (
    <DiaryView
      {...props}
      day={props.day}
      goals={goals.data}
      navigationSlot={
        <Stack gap="sm">
          <DayNavigation key={props.date} date={props.date} pending={loading} />
          {canWrite && (
            <DayRefreshControl
              key={`refresh:${props.date}`}
              date={props.date}
              onUpdated={() => revalidateVisibleReads()}
            />
          )}
        </Stack>
      }
      photos={diaryPhotos(ownerId, photos)}
      photoActions={
        canWrite && online
          ? createPhotoActions(ownerId, () => revalidateVisibleReads())
          : undefined
      }
    />
  );
}
