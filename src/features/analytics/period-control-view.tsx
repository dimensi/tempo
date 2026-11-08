'use client';
import { useState, useTransition } from 'react';
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  analyticsRangeSchema,
  type AnalyticsRange,
} from '@/contracts/analytics';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import { presetRange, type AnalyticsPreset } from './range';
import { analyticsMessages as m } from './messages';
import { rangeLabel } from './display';
import classes from './analytics.module.css';
export interface PeriodControlProps {
  range: AnalyticsRange;
  previous: AnalyticsRange;
  timezone: string;
  today: string;
}
export function PeriodControlView({
  range,
  previous,
  timezone,
  today,
  onNavigate,
}: PeriodControlProps & { onNavigate: (range: AnalyticsRange) => void }) {
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState(false);
  const calendarPresets: AnalyticsPreset[] = [
    'previousWeek',
    'currentWeek',
    'previousMonth',
    'currentMonth',
  ];
  const selectedPreset = calendarPresets.find((key) => {
    const candidate = presetRange(key, today);
    return candidate.from === range.from && candidate.to === range.to;
  });
  function navigate(next: AnalyticsRange) {
    const parsed = analyticsRangeSchema.safeParse(next);
    setError(!parsed.success);
    if (!parsed.success) return;
    setCustom(false);
    startTransition(() => onNavigate(parsed.data));
  }
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" className={classes.toolbar}>
        <Select
          label={m.period}
          styles={{ option: { minHeight: 44 } }}
          className={classes.periodSelect}
          value={custom ? 'custom' : (selectedPreset ?? 'custom')}
          data={[
            {
              group: m.calendarPeriods,
              items: calendarPresets.map((key) => ({
                value: key,
                label: m[key],
              })),
            },
            { value: 'custom', label: m.custom },
          ]}
          maxDropdownHeight={320}
          allowDeselect={false}
          disabled={pending}
          onOptionSubmit={(value) => {
            if (value === 'custom') {
              setDraft(range);
              setError(false);
              setCustom(true);
            } else if (value) {
              navigate(
                presetRange(
                  value as AnalyticsPreset,
                  dateInTimezone(new Date(), timezone),
                ),
              );
            }
          }}
          comboboxProps={{ withinPortal: true }}
        />
        <Text fw={600} aria-live="polite">
          {rangeLabel(range)}
        </Text>
      </Group>
      <Text size="sm" c="dimmed">
        {m.calendarPeriodHint}
      </Text>
      {custom && (
        <form
          id="analytics-custom-period"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(draft);
          }}
        >
          <Group align="end">
            <TextInput
              type="date"
              label={m.from}
              value={draft.from}
              required
              onChange={(event) =>
                setDraft({ ...draft, from: event.currentTarget.value })
              }
              className={classes.dateField}
            />
            <TextInput
              type="date"
              label={m.to}
              value={draft.to}
              required
              onChange={(event) =>
                setDraft({ ...draft, to: event.currentTarget.value })
              }
              className={classes.dateField}
            />
            <Button type="submit" loading={pending} mih={44} autoContrast>
              {m.apply}
            </Button>
          </Group>
        </form>
      )}
      {error && <Alert color="red">{m.rangeError}</Alert>}
      <Text size="sm" c="dimmed">
        {m.comparison}: {rangeLabel(previous)}
      </Text>
    </Stack>
  );
}
