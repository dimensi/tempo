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
  NumberInput,
  NativeSelect,
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

function DateJump({
  date,
  onSelect,
}: {
  date: string;
  onSelect: (date: string) => void;
}) {
  const [year, setYear] = useState<string | number>(Number(date.slice(0, 4)));
  const [month, setMonth] = useState(date.slice(5, 7));
  const [day, setDay] = useState(date.slice(8, 10));
  const validYear =
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= 1 &&
    year <= 9999;
  const lastDay = new Date(
    `${String(validYear ? year : 2000).padStart(4, '0')}-${month}-01T12:00:00Z`,
  );
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const days = lastDay.getUTCDate();
  const selectedDay = String(Math.min(Number(day), days)).padStart(2, '0');
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (validYear)
          onSelect(`${String(year).padStart(4, '0')}-${month}-${selectedDay}`);
      }}
    >
      <Stack gap="sm">
        <NumberInput
          label={m.year}
          value={year}
          onChange={setYear}
          min={1}
          max={9999}
          allowDecimal={false}
          allowNegative={false}
          required
          size="md"
        />
        <Group grow wrap="nowrap">
          <NativeSelect
            label={m.month}
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
            size="md"
            data={Array.from({ length: 12 }, (_, index) => {
              const value = String(index + 1).padStart(2, '0');
              return {
                value,
                label: format(`2000-${value}-01`, { month: 'long' }),
              };
            })}
          />
          <NativeSelect
            label={m.day}
            value={selectedDay}
            onChange={(event) => setDay(event.currentTarget.value)}
            size="md"
            data={Array.from({ length: days }, (_, index) => ({
              value: String(index + 1).padStart(2, '0'),
              label: String(index + 1),
            }))}
          />
        </Group>
        <Button type="submit" disabled={!validYear} mih={44}>
          {m.open}
        </Button>
      </Stack>
    </Box>
  );
}

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
          <Popover.Dropdown w={280} maw="calc(100vw - 32px)">
            <DateJump
              date={date}
              onSelect={(value) =>
                router.push(`/diary?date=${value}`, { scroll: false })
              }
            />
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
