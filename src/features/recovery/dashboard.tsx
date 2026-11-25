'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LineChart } from '@mantine/charts';
import {
  Accordion,
  Anchor,
  Divider,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type {
  RecoveryDay,
  RecoveryHistory,
  RecoveryMetric,
  RecoveryMetricSummary,
  RecoverySleepEpisode,
} from '@/contracts/recovery';
import { recoveryMessages as m } from './messages';
import { RecoveryRangeControls } from './range-controls';
import classes from './recovery.module.css';

const calendarDay = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  weekday: 'short',
  timeZone: 'UTC',
});
const chartDay = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'numeric',
  timeZone: 'UTC',
});
const quantity = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1,
});
const metricNames = Object.keys(m.metrics) as RecoveryMetric[];

function duration(seconds: number) {
  if (seconds > 0 && seconds < 60) return '< 1 мин';
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function metricDisplay(metric: RecoveryMetricSummary) {
  const unit = m.units[metric.unit];
  return unit
    ? `${quantity.format(metric.value)} ${unit}`
    : quantity.format(metric.value);
}

function SleepDetails({
  sleep,
  timezone,
}: {
  sleep: RecoverySleepEpisode;
  timezone: string;
}) {
  const clock = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });
  const times = [
    { label: m.duration, value: duration(sleep.durationSeconds) },
    { label: m.fellAsleep, value: clock.format(new Date(sleep.startAt)) },
    { label: m.wokeUp, value: clock.format(new Date(sleep.endAt)) },
  ];
  const stages = Object.entries(sleep.stages) as Array<
    [keyof typeof m.stagesLabels, number]
  >;
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing={{ base: 'xs', xs: 'md' }}>
        {times.map(({ label, value }) => (
          <div key={label}>
            <Text size="sm">{label}</Text>
            <Text fw={600} className={classes.value}>
              {value}
            </Text>
          </div>
        ))}
      </SimpleGrid>
      <Stack gap={4}>
        <Text size="sm" fw={600}>
          {m.stages}
        </Text>
        {stages.length ? (
          <Group gap="sm">
            {stages.map(([stage, seconds]) => (
              <Text key={stage} size="sm" className={classes.value}>
                {m.stagesLabels[stage]} <strong>{duration(seconds)}</strong>
              </Text>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            {m.noStages}
          </Text>
        )}
      </Stack>
      <Group gap="sm">
        {sleep.awakeSeconds !== null && (
          <Text size="sm" className={classes.value}>
            {m.awake} <strong>{duration(sleep.awakeSeconds)}</strong>
          </Text>
        )}
        {sleep.inBedSeconds !== null && (
          <Text size="sm" className={classes.value}>
            {m.inBed} <strong>{duration(sleep.inBedSeconds)}</strong>
          </Text>
        )}
      </Group>
      {!!sleep.sources.length && (
        <Text size="sm" className={classes.source}>
          {m.deviceSources} · {sleep.sources.join(', ')}
        </Text>
      )}
    </Stack>
  );
}

function MetricHistory({ day }: { day: RecoveryDay }) {
  const entries = metricNames.flatMap((key) => {
    const metric = day.metrics[key];
    return metric ? [{ name: m.metrics[key], metric }] : [];
  });
  if (!entries.length) return null;
  return (
    <Stack gap="xs" component="dl" m={0}>
      {entries.map(({ name, metric }) => (
        <Group
          key={name}
          justify="space-between"
          align="baseline"
          gap="xs"
          className={classes.observation}
        >
          <Text component="dt" size="sm">
            {name}
          </Text>
          <Text
            component="dd"
            size="sm"
            m={0}
            fw={600}
            className={classes.value}
          >
            {metricDisplay(metric)}
          </Text>
          <Text
            component="dd"
            size="sm"
            m={0}
            w="100%"
            className={classes.source}
          >
            {m.observations} · {metric.count}
            {metric.sources.length > 0 &&
              ` · ${m.deviceSources} · ${metric.sources.join(', ')}`}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

function MetricTrends({ history }: { history: RecoveryHistory }) {
  const [selection, setSelection] = useState<string | null>(null);
  const available = metricNames.filter((name) => history.summary.metrics[name]);
  const selected = available.find((name) => name === selection) ?? available[0];
  if (!selected) return null;
  const metric = history.summary.metrics[selected]!;
  const observedDays = history.days.filter(
    (day) => day.metrics[selected],
  ).length;
  return (
    <Stack gap="sm">
      <Select
        label={m.metricSelect}
        data={available.map((name) => ({
          value: name,
          label: m.metrics[name],
        }))}
        value={selected}
        onChange={setSelection}
        allowDeselect={false}
        maw={420}
        size="md"
        comboboxProps={{ withinPortal: true }}
      />
      <Group gap="md">
        <Text size="sm" className={classes.value}>
          {m.average} · <strong>{metricDisplay(metric)}</strong>
        </Text>
        <Text size="sm" className={classes.value}>
          {m.count} ·{' '}
          <strong>
            {observedDays}/{history.days.length}
          </strong>
        </Text>
      </Group>
      <LineChart
        h={180}
        data={history.days.map(({ date, metrics }) => ({
          date: chartDay.format(new Date(date)),
          value: metrics[selected]?.value ?? null,
        }))}
        dataKey="date"
        series={[
          { name: 'value', label: m.metrics[selected], color: 'teal.7' },
        ]}
        unit={m.units[metric.unit] ? ` ${m.units[metric.unit]}` : undefined}
        curveType="linear"
        connectNulls={false}
        withLegend={false}
        yAxisProps={{ width: 78, domain: ['auto', 'auto'] }}
        aria-label={m.metrics[selected]}
      />
    </Stack>
  );
}

export function RecoveryDashboard({
  history,
  today,
  days,
}: {
  history: RecoveryHistory;
  today: string;
  days: 7 | 14;
}) {
  const { range, summary } = history;
  const reverse = [...history.days].reverse();
  const latest = reverse.find((day) => day.sleep.length);
  const latestSleep = latest?.sleep.reduce((longest, episode) =>
    episode.durationSeconds >= longest.durationSeconds ? episode : longest,
  );
  const observed = reverse.filter(
    (day) => day.sleep.length || Object.keys(day.metrics).length,
  );
  return (
    <Stack gap="xl">
      <Group justify="space-between" gap="xs">
        <Text size="sm">{m.source}</Text>
        <Anchor
          component={Link}
          href="/settings#apple-health"
          prefetch={false}
          size="sm"
          className={classes.touchLink}
        >
          {m.settings}
        </Anchor>
      </Group>

      {latest && latestSleep && (
        <Paper
          withBorder
          p={{ base: 'sm', sm: 'lg' }}
          component="section"
          aria-labelledby="recovery-last-sleep"
        >
          <Stack gap="md">
            <Group justify="space-between" align="baseline" gap="xs">
              <Title id="recovery-last-sleep" order={2} size="h4">
                {m.recent}
              </Title>
              <Text size="sm">{calendarDay.format(new Date(latest.date))}</Text>
            </Group>
            <SleepDetails sleep={latestSleep} timezone={range.timezone} />
          </Stack>
        </Paper>
      )}

      <Stack component="section" aria-labelledby="recovery-trends" gap="md">
        <Title id="recovery-trends" order={2} size="h4">
          {m.trend}
        </Title>
        <RecoveryRangeControls {...range} today={today} days={days} />
        {summary.sleep.nights > 0 ? (
          <Stack gap="sm">
            <Title order={3} size="h5">
              {m.sleepChart}
            </Title>
            <Group gap="md">
              {summary.sleep.averageDurationSeconds !== null && (
                <Text size="sm" className={classes.value}>
                  {m.average} ·{' '}
                  <strong>
                    {duration(summary.sleep.averageDurationSeconds)}
                  </strong>
                </Text>
              )}
              <Text size="sm" className={classes.value}>
                {m.count} ·{' '}
                <strong>
                  {summary.sleep.nights}/{history.days.length}
                </strong>
              </Text>
            </Group>
            <LineChart
              h={205}
              data={history.days.map(({ date, sleep }) => ({
                date: chartDay.format(new Date(date)),
                value: sleep.length
                  ? Math.round(
                      sleep.reduce(
                        (total, episode) => total + episode.durationSeconds,
                        0,
                      ) / 360,
                    ) / 10
                  : null,
              }))}
              dataKey="date"
              series={[{ name: 'value', label: m.duration, color: 'teal.7' }]}
              unit=" ч"
              curveType="linear"
              connectNulls={false}
              yAxisProps={{ width: 55, domain: [0, 'auto'] }}
              aria-label={m.sleepChart}
            />
          </Stack>
        ) : (
          <Text>{observed.length ? m.noSleep : m.noData}</Text>
        )}
        <MetricTrends history={history} />
        {observed.length ? (
          <Text size="sm">{m.chartDays}</Text>
        ) : (
          <Text size="sm">{m.noDataHelp}</Text>
        )}
      </Stack>

      {!!observed.length && (
        <Stack component="section" aria-labelledby="recovery-history" gap="md">
          <Title id="recovery-history" order={2} size="h4">
            {m.history}
          </Title>
          <Accordion variant="contained">
            {observed.map((day) => (
              <Accordion.Item key={day.date} value={day.date}>
                <Accordion.Control mih={48}>
                  <Group justify="space-between" gap="xs">
                    <Text span fw={600}>
                      {calendarDay.format(new Date(day.date))}
                    </Text>
                    {day.sleep.length > 0 && (
                      <Text span size="sm" className={classes.value}>
                        {m.total} ·{' '}
                        {duration(
                          day.sleep.reduce(
                            (total, episode) => total + episode.durationSeconds,
                            0,
                          ),
                        )}
                      </Text>
                    )}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    {day.sleep.map((episode) => (
                      <SleepDetails
                        key={episode.startAt}
                        sleep={episode}
                        timezone={range.timezone}
                      />
                    ))}
                    {day.sleep.length > 0 &&
                      Object.keys(day.metrics).length > 0 && <Divider />}
                    <MetricHistory day={day} />
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Stack>
      )}
    </Stack>
  );
}
