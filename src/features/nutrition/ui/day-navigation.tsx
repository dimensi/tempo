'use client';

import { useState } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
  VisuallyHidden,
} from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
} from '@tabler/icons-react';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { diaryMessages as m } from './messages';
import { browserToday, weekDates } from './day-navigation-dates';

function DayLabel({ value }: { value: string }) {
  const { pending } = useLinkStatus();
  return (
    <Stack
      gap={2}
      align="center"
      aria-busy={pending}
      style={{ opacity: pending ? 0.5 : 1 }}
    >
      <Text size="xs" component="span">
        {format(value, { weekday: 'short' })}
      </Text>
      <Text fw={700} size="lg" component="span">
        {Number(value.slice(-2))}
      </Text>
      {pending && <VisuallyHidden role="status">{m.loadingDay}</VisuallyHidden>}
    </Stack>
  );
}

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );

export function DayNavigation({ date }: { date: string }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState(date);
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const dates = weekDates(anchor);
  return (
    <Stack gap="xs" component="nav" aria-label={m.dayNavigation}>
      <Group justify="space-between" wrap="nowrap">
        <Popover position="bottom-start" withArrow>
          <Popover.Target>
            <Button
              variant="subtle"
              rightSection={<IconChevronDown size={16} />}
              mih={44}
              aria-label={m.jumpDate}
            >
              {format(anchor, { month: 'long', year: 'numeric' })}
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Box component="form" action="/diary" method="get">
              <Stack gap="sm">
                <TextInput
                  type="date"
                  name="date"
                  label={m.date}
                  defaultValue={date}
                  required
                />
                <Button type="submit">{m.open}</Button>
              </Stack>
            </Box>
          </Popover.Dropdown>
        </Popover>
        <Button
          onClick={() => {
            const today = browserToday();
            setAnchor(today);
            router.push(`/diary?date=${today}`, { scroll: false });
          }}
          variant="light"
          mih={44}
        >
          {m.today}
        </Button>
      </Group>
      <Group justify="space-between" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size={44}
          aria-label={m.previousWeek}
          onClick={() => setAnchor(shiftDate(anchor, -7))}
        >
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Text size="sm" c="dimmed" aria-live="polite">
          {format(dates[0]!, { day: 'numeric', month: 'short' })} —{' '}
          {format(dates[6]!, { day: 'numeric', month: 'short' })}
        </Text>
        <ActionIcon
          variant="subtle"
          size={44}
          aria-label={m.nextWeek}
          onClick={() => setAnchor(shiftDate(anchor, 7))}
        >
          <IconChevronRight size={20} />
        </ActionIcon>
      </Group>
      <Group wrap="nowrap" gap={4}>
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            flex: 1,
            minWidth: 0,
            touchAction: 'pan-y',
          }}
          onTouchStart={(event) =>
            setTouch({
              x: event.touches[0]!.clientX,
              y: event.touches[0]!.clientY,
            })
          }
          onTouchEnd={(event) => {
            if (!touch) return;
            const dx = event.changedTouches[0]!.clientX - touch.x;
            const dy = event.changedTouches[0]!.clientY - touch.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
              setAnchor(shiftDate(anchor, dx < 0 ? 7 : -7));
            setTouch(null);
          }}
        >
          {dates.map((value) => (
            <Button
              key={value}
              component={Link}
              href={`/diary?date=${value}`}
              prefetch={false}
              scroll={false}
              variant={value === date ? 'filled' : 'subtle'}
              aria-current={value === date ? 'date' : undefined}
              aria-label={format(value, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              h={68}
              px={0}
              radius="md"
            >
              <DayLabel value={value} />
            </Button>
          ))}
        </Box>
      </Group>
      {!dates.includes(date) && (
        <Text size="sm" c="dimmed">
          {m.openedDay}:{' '}
          {format(date, { day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>
      )}
    </Stack>
  );
}
