'use client';
import {
  dateInTimezone,
  timezoneSchema,
} from '@/contracts/nutrition-sync-dates';
import { ResourcePending } from '@/components/shared/read-resource-pending';
import { readWorkspaceMessages as m } from '@/config/read-workspace';
import { analyticsRangeSchema } from '@/contracts/analytics';
import {
  AnalyticsDashboard,
  AnalyticsTimezone,
  parseAnalyticsPeriod,
  PeriodControl,
  presetRange,
} from '@/features/analytics';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { ExerciseProgressOverview } from '@/components/shared/exercise-progress/overview';
import { Text } from '@mantine/core';
import { useSearchParams } from 'next/navigation';
export default function Page() {
  const params = useSearchParams();
  const context = useReadResource(readResources.context('/api/read/context'));
  const timezone =
    params.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = timezoneSchema.safeParse(timezone);
  const today = zone.success
    ? dateInTimezone(new Date(), zone.data)
    : undefined;
  const hasExplicitRange = params.has('from') || params.has('to');
  const period = hasExplicitRange
    ? parseAnalyticsPeriod(params.get('period'))
    : 'previousWeek';
  const range = analyticsRangeSchema.safeParse(
    hasExplicitRange
      ? { from: params.get('from'), to: params.get('to') }
      : today
        ? presetRange('previousWeek', today)
        : undefined,
  );
  const resource = useReadResource(
    readResources.analytics(
      range.success && zone.success
        ? `/api/read/analytics?${new URLSearchParams({ ...range.data, timezone })}`
        : undefined,
    ),
  );
  if (!params.has('timezone'))
    return (
      <AnalyticsTimezone
        from={params.get('from') ?? undefined}
        to={params.get('to') ?? undefined}
        period={period}
      />
    );
  if (!range.success || !zone.success) return <Text>{m.invalidRange}</Text>;
  return resource.data ? (
    <AnalyticsDashboard
      workoutProgressSlot={
        context.data?.ownerId ? (
          <ExerciseProgressOverview
            key={context.data.ownerId}
            ownerId={context.data.ownerId}
            from={resource.data.range.from}
            to={resource.data.range.to}
          />
        ) : undefined
      }
      data={resource.data}
      navigationSlot={
        <PeriodControl
          range={resource.data.range}
          previous={resource.data.previousRange}
          period={period}
          today={resource.data.today}
          timezone={timezone}
        />
      }
    />
  ) : (
    <ResourcePending {...resource} />
  );
}
