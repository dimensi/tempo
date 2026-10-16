'use client';

import { useEffect } from 'react';
import { useSavedMealPhotos } from '@/lib/use-saved-meal-photos';
import {
  useReadRouter as useRouter,
  useReadSearchParams as useSearchParams,
} from '@/lib/workspace-navigation';
import { Stack } from '@mantine/core';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { DayNavigation } from './day-navigation';
import { diaryDateSchema, type SafeMealPhotoView } from '@/contracts/nutrition';
import { DiaryView, type DiaryViewProps } from './diary-view';
import { createPhotoActions, diaryPhotos } from './photo-actions';
import { DayRefreshControl } from './day-refresh-control';

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
  const router = useRouter();
  const savedPhotos = useSavedMealPhotos(photos);
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
      navigationSlot={
        <Stack gap="sm">
          <DayNavigation key={props.date} date={props.date} pending={loading} />
          {canWrite && (
            <DayRefreshControl
              key={`refresh:${props.date}`}
              date={props.date}
              onUpdated={() => router.refresh()}
            />
          )}
        </Stack>
      }
      photos={
        savedPhotos.online ? diaryPhotos(ownerId, photos) : savedPhotos.photos
      }
      photoActions={
        canWrite && savedPhotos.online
          ? createPhotoActions(ownerId, () => router.refresh())
          : undefined
      }
    />
  );
}
