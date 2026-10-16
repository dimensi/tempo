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
  PeriodControl,
  presetRange,
} from '@/features/analytics';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Text } from '@mantine/core';
import { useSearchParams } from 'next/navigation';
export default function Page() {
  const params = useSearchParams();
  const timezone =
    params.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = timezoneSchema.safeParse(timezone);
  const today = zone.success
    ? dateInTimezone(new Date(), zone.data)
    : undefined;
  const range = analyticsRangeSchema.safeParse(
    params.has('from') || params.has('to')
      ? { from: params.get('from'), to: params.get('to') }
      : today
        ? presetRange('week', today)
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
      />
    );
  if (!range.success || !zone.success) return <Text>{m.invalidRange}</Text>;
  return resource.data ? (
    <AnalyticsDashboard
      data={resource.data}
      navigationSlot={
        <PeriodControl
          range={resource.data.range}
          previous={resource.data.previousRange}
          today={resource.data.today}
          timezone={timezone}
        />
      }
    />
  ) : (
    <ResourcePending {...resource} />
  );
}
