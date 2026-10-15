'use client';
import { useState, useTransition } from 'react';
import { Alert, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import {
  analyticsRangeSchema,
  type AnalyticsRange,
} from '@/contracts/analytics';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import { presetRange } from './range';
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
  const presets = [
    { key: 'week' as const, label: m.week },
    { key: 'month' as const, label: m.month },
    { key: 'quarter' as const, label: m.quarter },
  ];
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
        <Group gap="xs" className={classes.periodButtons}>
          {presets.map((preset) => {
            const candidate = presetRange(preset.key, today);
            return (
              <Button
                key={preset.key}
                autoContrast
                variant={
                  candidate.from === range.from && candidate.to === range.to
                    ? 'filled'
                    : 'default'
                }
                aria-pressed={
                  candidate.from === range.from && candidate.to === range.to
                }
                disabled={pending}
                onClick={() =>
                  navigate(
                    presetRange(
                      preset.key,
                      dateInTimezone(new Date(), timezone),
                    ),
                  )
                }
                mih={44}
                size="xs"
                fz="sm"
              >
                {preset.label}
              </Button>
            );
          })}
          <Button
            variant="subtle"
            mih={44}
            size="xs"
            fz="sm"
            aria-expanded={custom}
            aria-controls="analytics-custom-period"
            onClick={() => setCustom(!custom)}
            disabled={pending}
          >
            {m.period}
          </Button>
        </Group>
        <Text fw={600} aria-live="polite">
          {rangeLabel(range)}
        </Text>
      </Group>
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
