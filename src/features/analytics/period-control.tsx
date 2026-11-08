'use client';
import { PageHeader } from '@/components/layout/page-header';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import { Skeleton, Stack, Text } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { analyticsMessages as m } from './messages';
import {
  PeriodControlView,
  type PeriodControlProps,
} from './period-control-view';
import { presetRange, type AnalyticsPeriod } from './range';
export function AnalyticsTimezone({
  from,
  to,
  period,
}: {
  from?: string | string[];
  to?: string | string[];
  period?: AnalyticsPeriod;
}) {
  const router = useRouter();
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const range =
      from === undefined && to === undefined
        ? presetRange('previousWeek', dateInTimezone(new Date(), timezone))
        : {
            from: Array.isArray(from) ? '' : (from ?? ''),
            to: Array.isArray(to) ? '' : (to ?? ''),
          };
    const query = new URLSearchParams({ ...range, timezone });
    if (period) query.set('period', period);
    router.replace(`/analytics?${query.toString()}`);
  }, [router, from, to, period]);
  return (
    <Stack aria-label={m.loading}>
      <PageHeader>{m.title}</PageHeader>
      <Text c="dimmed">{m.description}</Text>
      <Skeleton h={44} />
      <Skeleton h={150} />
      <Skeleton h={300} />
    </Stack>
  );
}
export function PeriodControl(props: PeriodControlProps) {
  const router = useRouter();
  return (
    <PeriodControlView
      {...props}
      onNavigate={(range, period) => {
        const href = `/analytics?${new URLSearchParams({ ...range, timezone: props.timezone, period })}`;
        router.push(href, { scroll: false });
      }}
    />
  );
}
