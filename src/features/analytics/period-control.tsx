'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Group,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  analyticsRangeSchema,
  type AnalyticsRange,
} from '@/contracts/analytics';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import { presetRange } from './range';
import { analyticsMessages as m } from './messages';
import { rangeLabel } from './display';
import classes from './analytics.module.css';
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
export function PeriodControl({
  range,
  previous,
  timezone,
  today,
}: {
  range: AnalyticsRange;
  previous: AnalyticsRange;
  timezone: string;
  today: string;
}) {
  const router = useRouter();
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
    startTransition(() =>
      router.push(
        `/analytics?${new URLSearchParams({ ...parsed.data, timezone })}`,
        { scroll: false },
      ),
    );
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
