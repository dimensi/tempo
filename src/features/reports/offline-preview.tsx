'use client';
import { useEffect, useState } from 'react';
import { Text } from '@mantine/core';
import type { NutritionDay, SafeMealPhotoView } from '@/contracts/nutrition';
import {
  reportLimits,
  type ReportRequest,
  type ReportDataset,
} from '@/contracts/reports';
import { renderReportHtml } from '@/lib/reports/template';
import { reportMessages as m } from '@/config/reports';
export type OfflineReportPhoto = SafeMealPhotoView & { bytes: Blob | null };
export function OfflineReportPreview({
  request,
  dailyStepsGoal,
  days,
  steps,
  photos,
}: {
  request: ReportRequest;
  dailyStepsGoal: number | null;
  days: NutritionDay[];
  steps: { date: string; steps: number | null }[];
  photos: OfflineReportPhoto[];
}) {
  const [copy, setCopy] = useState<{
    key: string;
    photos: OfflineReportPhoto[];
    html: string;
  } | null>(null);
  const key = `${request.ownerId}:${request.period}:${request.start}:${request.end}:${dailyStepsGoal}`;
  useEffect(() => {
    let active = true;
    const within = (date: string) =>
      date >= request.start && date <= request.end;
    let budget = reportLimits.totalPhotoBytes;
    const selected = photos
      .filter((photo) => within(photo.date))
      .slice(0, reportLimits.photos);
    void Promise.all(
      selected.map(async ({ bytes, ...photo }) => {
        if (
          !bytes ||
          bytes.size > reportLimits.photoBytes ||
          bytes.size > budget
        )
          return { ...photo, dataUri: null };
        budget -= bytes.size;
        try {
          const dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              typeof reader.result === 'string'
                ? resolve(reader.result)
                : reject(Error());
            reader.onerror = () => reject(Error());
            reader.readAsDataURL(bytes);
          });
          return { ...photo, dataUri };
        } catch {
          return { ...photo, dataUri: null };
        }
      }),
    ).then((images) => {
      const dataset: ReportDataset = {
        dailyStepsGoal,
        days: days.filter((day) => within(day.date)),
        steps: steps
          .filter((day) => within(day.date))
          .map((day) => ({ ...day, source: 'YAZIO' })),
        photos: images,
      };
      if (active)
        setCopy({
          key,
          photos,
          html: renderReportHtml({ ...request, format: 'html' }, dataset),
        });
    });
    return () => {
      active = false;
    };
  }, [key, request, dailyStepsGoal, days, steps, photos]);
  const html = copy?.key === key && copy.photos === photos ? copy.html : '';
  return (
    <>
      <Text size="sm" c="dimmed">
        {m.offlinePreview}
      </Text>
      <iframe
        title={m.preview}
        sandbox=""
        srcDoc={html}
        aria-busy={!html}
        style={{ width: '100%', height: 700, border: '1px solid #ccd4de' }}
      />
    </>
  );
}
