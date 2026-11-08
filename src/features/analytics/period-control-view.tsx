'use client';
import { useRef, useState, useTransition } from 'react';
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
import {
  calendarPresets,
  parseAnalyticsPeriod,
  presetRange,
  type AnalyticsPeriod,
} from './range';
import { analyticsMessages as m } from './messages';
import { rangeLabel } from './display';
import classes from './analytics.module.css';
export interface PeriodControlProps {
  range: AnalyticsRange;
  previous: AnalyticsRange;
  period?: AnalyticsPeriod;
  timezone: string;
  today: string;
}
export function PeriodControlView({
  range,
  previous,
  period,
  timezone,
  today,
  onNavigate,
}: PeriodControlProps & {
  onNavigate: (range: AnalyticsRange, period: AnalyticsPeriod) => void;
}) {
  const selectRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<AnalyticsRange | null>(null);
  const [error, setError] = useState(false);
  const selectedPeriod =
    period ??
    calendarPresets.find((key) => {
      const candidate = presetRange(key, today);
      return candidate.from === range.from && candidate.to === range.to;
    }) ??
    'custom';
  function closeEditor() {
    setDraft(null);
    setError(false);
  }
  function navigate(next: AnalyticsRange, nextPeriod: AnalyticsPeriod) {
    const parsed = analyticsRangeSchema.safeParse(next);
    setError(!parsed.success);
    if (!parsed.success) return;
    closeEditor();
    startTransition(() => onNavigate(parsed.data, nextPeriod));
  }
  return (
    <Stack gap="sm">
      <Select
        ref={selectRef}
        label={m.period}
        styles={{ option: { minHeight: 44 } }}
        className={classes.periodSelect}
        value={draft ? 'custom' : selectedPeriod}
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
        onOptionSubmit={(option) => {
          const value = parseAnalyticsPeriod(option);
          if (value === 'custom') {
            setDraft((current) => current ?? range);
          } else if (value) {
            navigate(
              presetRange(value, dateInTimezone(new Date(), timezone)),
              value,
            );
          }
        }}
        comboboxProps={{ withinPortal: true }}
      />
      <Stack gap={4}>
        <Text size="sm" fw={600} aria-live="polite">
          {m.selectedDates}: {rangeLabel(range)}
        </Text>
        <Text size="sm" c="dimmed">
          {m.comparison}: {rangeLabel(previous)}
        </Text>
      </Stack>
      <Text size="sm" c="dimmed">
        {m.calendarPeriodHint}
      </Text>
      {draft && (
        <form
          id="analytics-custom-period"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(draft, 'custom');
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
            <Group gap="xs">
              <Button type="submit" loading={pending} mih={44} autoContrast>
                {m.apply}
              </Button>
              <Button
                type="button"
                variant="default"
                mih={44}
                onClick={() => {
                  closeEditor();
                  selectRef.current?.focus();
                }}
              >
                {m.cancel}
              </Button>
            </Group>
          </Group>
        </form>
      )}
      {error && <Alert color="red">{m.rangeError}</Alert>}
    </Stack>
  );
}
