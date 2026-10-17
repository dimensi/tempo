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
  Drawer,
  VisuallyHidden,
} from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconCalendar,
} from '@tabler/icons-react';
import { DatePicker } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import 'dayjs/locale/ru';
import { dateNavigationMessages as calendarMessages } from '@/config/date-navigation';
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
  return (
    <Stack gap="sm" align="center">
      <DatePicker
        locale="ru"
        firstDayOfWeek={1}
        value={date}
        defaultDate={date}
        onChange={(value) => {
          if (value) onSelect(value);
        }}
        size="md"
        fullWidth
        style={{ width: 'min(308px, calc(100vw - 64px))' }}
        styles={{
          day: { minHeight: 44, fontSize: 16 },
          calendarHeaderControl: { minWidth: 44, minHeight: 44 },
        }}
        ariaLabels={calendarMessages.calendar}
        getDayAriaLabel={(value) => format(value, { dateStyle: 'full' })}
      />
      <Button
        variant="subtle"
        mih={44}
        fullWidth
        onClick={() => onSelect(browserToday())}
      >
        {m.today}
      </Button>
    </Stack>
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
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const [opened, setOpened] = useState(false);
  const ios =
    mobile &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const selectDate = (value: string) => {
    setAnchor(value);
    setOpened(false);
    onSelect(value);
  };
  // Follow the URL date when Next restores a history entry.
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
    <Stack
      gap="xs"
      component="nav"
      aria-label={m.dayNavigation}
      onKeyDown={(event) => {
        if (
          !disabled &&
          event.target instanceof Element &&
          event.target.closest(`.${classes.days}`) &&
          (event.key === 'PageUp' || event.key === 'PageDown')
        ) {
          event.preventDefault();
          setAnchor(shiftDate(anchor, event.key === 'PageUp' ? -7 : 7));
        }
      }}
    >
      {mobile ? (
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={650} className={classes.selectedDate}>
            {format(date, { day: 'numeric', month: 'long' })},{' '}
            {format(date, { weekday: 'long' })}
          </Text>
          <Group gap={0} wrap="nowrap">
            {date !== browserToday() && (
              <Button
                variant="subtle"
                mih={44}
                px={6}
                onClick={() => selectDate(browserToday())}
                disabled={disabled}
              >
                {m.today}
              </Button>
            )}
            {ios ? (
              <Box className={classes.nativeTrigger}>
                <ActionIcon
                  component="span"
                  variant="subtle"
                  size={44}
                  aria-hidden
                >
                  <IconCalendar size={20} />
                </ActionIcon>
                <input
                  type="date"
                  value={date}
                  disabled={disabled}
                  aria-label={m.jumpDate}
                  className={classes.nativeDate}
                  onChange={(event) => {
                    if (
                      event.currentTarget.validity.valid &&
                      event.currentTarget.value
                    )
                      selectDate(event.currentTarget.value);
                  }}
                />
              </Box>
            ) : (
              <ActionIcon
                variant="subtle"
                size={44}
                aria-label={m.jumpDate}
                onClick={() => setOpened(true)}
                disabled={disabled}
              >
                <IconCalendar size={20} />
              </ActionIcon>
            )}
          </Group>
          <Drawer
            opened={opened}
            onClose={() => setOpened(false)}
            position="bottom"
            title={m.jumpDate}
            closeButtonProps={{ 'aria-label': calendarMessages.close }}
            size="auto"
            padding="md"
            styles={{
              body: {
                paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
              },
            }}
          >
            <DateJump key={date} date={date} labels={m} onSelect={selectDate} />
          </Drawer>
        </Group>
      ) : (
        <Group justify="space-between" wrap="nowrap">
          <Popover
            position="bottom-start"
            withArrow
            opened={opened}
            onChange={setOpened}
          >
            <Popover.Target>
              <Button
                styles={{ root: { fontSize: 16 } }}
                disabled={disabled}
                variant="subtle"
                rightSection={<IconChevronDown size={16} />}
                mih={44}
                aria-label={m.jumpDate}
                onClick={() => setOpened((value) => !value)}
              >
                {format(anchor, { month: 'long', year: 'numeric' })}
              </Button>
            </Popover.Target>
            <Popover.Dropdown w="auto" maw="calc(100vw - 32px)">
              <DateJump
                key={date}
                date={date}
                labels={m}
                onSelect={selectDate}
              />
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
      )}
      <Group
        justify="space-between"
        wrap="nowrap"
        className={classes.weekControls}
      >
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
      {mobile && (
        <VisuallyHidden aria-live="polite">
          {format(dates[0]!, { day: 'numeric', month: 'long' })} —{' '}
          {format(dates[6]!, { day: 'numeric', month: 'long' })}
        </VisuallyHidden>
      )}
      <Group wrap="nowrap" gap={0}>
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
          onTouchCancel={() => setTouch(null)}
          onTouchStart={(event) =>
            setTouch(
              !disabled && event.touches.length === 1
                ? {
                    x: event.touches[0]!.clientX,
                    y: event.touches[0]!.clientY,
                  }
                : null,
            )
          }
          onTouchEnd={(event) => {
            if (!touch || disabled) return;
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
      {!mobile && !dates.includes(date) && (
        <Text size="md" c="dimmed">
          {m.openedDay}:{' '}
          {format(date, { day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>
      )}
    </Stack>
  );
}
