'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ActionIcon, Button, Group, Text } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { recoveryMessages as m } from './messages';

export function recoveryHref(days: number, timezone: string, to?: string) {
  const params = new URLSearchParams({ days: String(days), timezone });
  if (to) params.set('to', to);
  return `/recovery?${params}`;
}

export function RecoveryBrowserTimezone({
  days,
  to,
}: {
  days: number;
  to?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone && timezone !== 'UTC')
      router.replace(recoveryHref(days, timezone, to), { scroll: false });
  }, [days, router, to]);
  return null;
}

const displayDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function RecoveryRangeControls({
  days,
  from,
  to,
  today,
  timezone,
}: {
  days: 7 | 14;
  from: string;
  to: string;
  today: string;
  timezone: string;
}) {
  const next = shiftDate(to, days);
  const historical = to < today;
  return (
    <Group justify="space-between" gap="xs">
      <Group gap={4} role="group" aria-label={m.period}>
        {([7, 14] as const).map((size) => (
          <Button
            key={size}
            component={Link}
            href={recoveryHref(size, timezone, historical ? to : undefined)}
            variant={size === days ? 'filled' : 'subtle'}
            aria-current={size === days ? 'true' : undefined}
            prefetch={false}
            scroll={false}
            mih={44}
          >
            {size === 7 ? m.week : m.fortnight}
          </Button>
        ))}
      </Group>
      <Group gap={4} wrap="nowrap">
        <ActionIcon
          component={Link}
          href={recoveryHref(days, timezone, shiftDate(to, -days))}
          prefetch={false}
          scroll={false}
          variant="subtle"
          size={44}
          aria-label={m.previous}
        >
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Text size="sm" ta="center">
          {displayDate.formatRange(new Date(from), new Date(to))}
        </Text>
        {historical ? (
          <ActionIcon
            component={Link}
            href={recoveryHref(days, timezone, next < today ? next : undefined)}
            prefetch={false}
            scroll={false}
            variant="subtle"
            size={44}
            aria-label={m.next}
          >
            <IconChevronRight size={20} />
          </ActionIcon>
        ) : (
          <ActionIcon disabled size={44} variant="subtle" aria-label={m.next}>
            <IconChevronRight size={20} />
          </ActionIcon>
        )}
      </Group>
    </Group>
  );
}
