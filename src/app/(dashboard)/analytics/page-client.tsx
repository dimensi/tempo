'use client';
import { browserToday } from '@/components/shared/date-navigation-dates';
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
export function AnalyticsPage() {
  const params = useSearchParams();
  const today = browserToday();
  const timezone =
    params.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const range = analyticsRangeSchema.safeParse(
    params.has('from') || params.has('to')
      ? { from: params.get('from'), to: params.get('to') }
      : presetRange('week', today),
  );
  const resource = useReadResource(
    readResources.analytics(
      range.success
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
  if (!range.success) return <Text>{m.invalidRange}</Text>;
  return resource.data ? (
    <AnalyticsDashboard
      data={resource.data}
      navigationSlot={
        <PeriodControl
          range={resource.data.range}
          previous={resource.data.previousRange}
          today={today}
          timezone={timezone}
        />
      }
    />
  ) : (
    <ResourcePending {...resource} />
  );
}
