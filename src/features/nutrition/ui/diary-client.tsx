'use client';

import { useRouter } from 'next/navigation';
import type { SafeMealPhotoView } from '@/contracts/nutrition';
import { DiaryView, type DiaryViewProps } from './diary-view';
import { createPhotoActions, diaryPhotos } from './photo-actions';

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
  return (
    <DiaryView
      {...props}
      photos={diaryPhotos(ownerId, photos)}
      photoActions={
        canWrite
          ? createPhotoActions(ownerId, () => router.refresh())
          : undefined
      }
    />
  );
}
