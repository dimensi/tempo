'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
import { browserToday, weekDates } from './date-navigation-dates';
import classes from '@/components/shared/date-navigation.module.css';

function DateJump({
  date,
  onSelect,
  labels: m,
}: {
  date: string;
  onSelect: (date: string) => void;
  labels: DateNavigationLabels;
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
          styles={{ input: { fontSize: 16 } }}
        />
        <Group grow wrap="nowrap">
          <NativeSelect
            label={m.month}
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
            size="md"
            styles={{ input: { fontSize: 16 } }}
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
            styles={{ input: { fontSize: 16 } }}
            data={Array.from({ length: days }, (_, index) => ({
              value: String(index + 1).padStart(2, '0'),
              label: String(index + 1),
            }))}
          />
        </Group>
        <Button
          styles={{ root: { fontSize: 16 } }}
          type="submit"
          disabled={!validYear}
          mih={44}
        >
          {m.open}
        </Button>
      </Stack>
    </Box>
  );
}

export function DateDayLabel({
  value,
  pending = false,
  loadingLabel,
}: {
  value: string;
  pending?: boolean;
  loadingLabel: string;
}) {
  return (
    <Stack
      gap={2}
      align="center"
      aria-busy={pending}
      style={{ opacity: pending ? 0.5 : 1 }}
    >
      <Text size="md" component="span">
        {format(value, { weekday: 'short' })}
      </Text>
      <Text fw={700} size="lg" component="span">
        {Number(value.slice(-2))}
      </Text>
      {pending && <VisuallyHidden role="status">{loadingLabel}</VisuallyHidden>}
    </Stack>
  );
}

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );

export type DateNavigationLabels = {
  year: string;
  month: string;
  day: string;
  open: string;
  loadingDay: string;
  dayNavigation: string;
  jumpDate: string;
  today: string;
  previousWeek: string;
  nextWeek: string;
  openedDay: string;
};
export type DateDayButton = {
  value: string;
  selected: boolean;
  label: string;
  children: ReactNode;
};
export function DateNavigation({
  date,
  onSelect,
  labels: m,
  renderDay,
  disabled = false,
}: {
  date: string;
  onSelect: (date: string) => void;
  labels: DateNavigationLabels;
  renderDay?: (day: DateDayButton) => ReactNode;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState(date);
  // Activity preserves route state; on Back, bring its selected day back into view.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setAnchor(date);
    });
    return () => {
      active = false;
    };
  }, [date]);
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const dates = weekDates(anchor);
  return (
    <Stack gap="xs" component="nav" aria-label={m.dayNavigation}>
      <Group justify="space-between" wrap="nowrap">
        <Popover position="bottom-start" withArrow>
          <Popover.Target>
            <Button
              styles={{ root: { fontSize: 16 } }}
              disabled={disabled}
              variant="subtle"
              rightSection={<IconChevronDown size={16} />}
              mih={44}
              aria-label={m.jumpDate}
            >
              {format(anchor, { month: 'long', year: 'numeric' })}
            </Button>
          </Popover.Target>
          <Popover.Dropdown w={280} maw="calc(100vw - 32px)">
            <DateJump key={date} date={date} labels={m} onSelect={onSelect} />
          </Popover.Dropdown>
        </Popover>
        <Button
          styles={{ root: { fontSize: 16 } }}
          onClick={() => {
            const today = browserToday();
            setAnchor(today);
            onSelect(today);
          }}
          disabled={disabled}
          variant="light"
          mih={44}
        >
          {m.today}
        </Button>
      </Group>
      <Group justify="space-between" wrap="nowrap">
        <ActionIcon
          disabled={disabled}
          variant="subtle"
          size={44}
          aria-label={m.previousWeek}
          onClick={() => setAnchor(shiftDate(anchor, -7))}
        >
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Text size="md" c="dimmed" aria-live="polite">
          {format(dates[0]!, { day: 'numeric', month: 'short' })} —{' '}
          {format(dates[6]!, { day: 'numeric', month: 'short' })}
        </Text>
        <ActionIcon
          disabled={disabled}
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
          className={classes.days}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 4,
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
          {dates.map((value) => {
            const selected = value === date;
            const label = format(value, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
            const children = (
              <DateDayLabel value={value} loadingLabel={m.loadingDay} />
            );
            return renderDay ? (
              renderDay({ value, selected, label, children })
            ) : (
              <Button
                key={value}
                onClick={() => onSelect(value)}
                disabled={disabled}
                variant={selected ? 'filled' : 'subtle'}
                aria-current={selected ? 'date' : undefined}
                aria-label={label}
                h={68}
                px={0}
                radius="md"
              >
                {children}
              </Button>
            );
          })}
        </Box>
      </Group>
      {!dates.includes(date) && (
        <Text size="md" c="dimmed">
          {m.openedDay}:{' '}
          {format(date, { day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>
      )}
    </Stack>
  );
}
