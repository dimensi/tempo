'use client';

import { useEffect, useState } from 'react';
import { useReadRefresh } from '@/lib/use-read-refresh';
import { nutritionDaySchema } from '@/contracts/nutrition';
import { useRouter, useSearchParams } from 'next/navigation';
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
}

export function DiaryClient({
  ownerId,
  photos,
  canWrite,
  ...props
}: DiaryClientProps) {
  const router = useRouter();
  const refresh = useReadRefresh();
  const [model, setModel] = useState({ seed: props.day, day: props.day });
  if (model.seed !== props.day) setModel({ seed: props.day, day: props.day });
  useEffect(() => {
    let active = true;
    void fetch(
      `/api/nutrition/days/${props.date}?ownerId=${encodeURIComponent(ownerId)}`,
    )
      .then(async (response) => {
        if (!response.ok) return;
        const value = nutritionDaySchema.parse(await response.json());
        if (active) setModel({ seed: props.day, day: value });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ownerId, props.date, props.day, refresh]);
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
      day={model.day}
      navigationSlot={
        <Stack gap="sm">
          <DayNavigation key={props.date} date={props.date} />
          {canWrite && (
            <DayRefreshControl
              key={`refresh:${props.date}`}
              date={props.date}
              onUpdated={() => router.refresh()}
            />
          )}
        </Stack>
      }
      photos={diaryPhotos(ownerId, photos)}
      photoActions={
        canWrite
          ? createPhotoActions(ownerId, () => router.refresh())
          : undefined
      }
    />
  );
}
