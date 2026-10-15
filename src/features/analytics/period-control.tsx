'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { requestReadNavigation } from '@/components/shared/read-link';
import { Skeleton, Stack, Text, Title } from '@mantine/core';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import { presetRange } from './range';
import { analyticsMessages as m } from './messages';
import {
  PeriodControlView,
  type PeriodControlProps,
} from './period-control-view';
export function AnalyticsTimezone({
  from,
  to,
}: {
  from?: string | string[];
  to?: string | string[];
}) {
  const router = useRouter();
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const range =
      from === undefined && to === undefined
        ? presetRange('week', dateInTimezone(new Date(), timezone))
        : {
            from: Array.isArray(from) ? '' : (from ?? ''),
            to: Array.isArray(to) ? '' : (to ?? ''),
          };
    const query = new URLSearchParams({ ...range, timezone });
    router.replace(`/analytics?${query.toString()}`);
  }, [router, from, to]);
  return (
    <Stack aria-label={m.loading}>
      <Title order={1}>{m.title}</Title>
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
      onNavigate={(range) => {
        const href = `/analytics?${new URLSearchParams({ ...range, timezone: props.timezone })}`;
        requestReadNavigation(href, { scroll: false }, () =>
          router.push(href, { scroll: false }),
        );
      }}
    />
  );
}
