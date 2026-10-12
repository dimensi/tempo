'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import type { OverviewData } from '@/contracts/overview';
import { formatDecimal, toChartNumber } from '@/lib/number-display';
import { overviewMessages as m } from './messages';
import { localCalendar, nextMidnightDelay } from './calendar';
import classes from './overview.module.css';
const number = (value: string | null) => formatDecimal(value) ?? m.empty;
const date = (value: string) =>
  new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(
    new Date(`${value}T12:00:00`),
  );
export function Overview() {
  const [calendar, setCalendar] = useState<ReturnType<
    typeof localCalendar
  > | null>(null);
  const [resource, setResource] = useState<{
    key: string;
    data: OverviewData | null;
    error: number | null;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      const next = localCalendar();
      setCalendar((current) =>
        current?.today === next.today && current.timezone === next.timezone
          ? current
          : next,
      );
      clearTimeout(timer);
      timer = setTimeout(update, nextMidnightDelay());
    }
    function refresh() {
      update();
      setRevision((value) => value + 1);
    }
    function visible() {
      if (document.visibilityState === 'visible') refresh();
    }
    update();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  useEffect(() => {
    if (!calendar) return;
    const controller = new AbortController();
    const key = `${calendar.timezone}:${calendar.today}:${revision}`;
    fetch(`/api/overview?timezone=${encodeURIComponent(calendar.timezone)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<OverviewData>;
      })
      .then((value) => {
        if (!controller.signal.aborted)
          setResource({ key, data: value, error: null });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setResource({
            key,
            data: null,
            error: Number(reason.message) || 500,
          });
      });
    return () => controller.abort();
  }, [calendar, revision]);
  const key = calendar
    ? `${calendar.timezone}:${calendar.today}:${revision}`
    : '';
  const data = resource?.key === key ? resource.data : null;
  const error = resource?.key === key ? resource.error : null;
  const current =
    data &&
    data.today === calendar?.today &&
    data.timezone === calendar.timezone
      ? data
      : null;
  return (
    <Stack gap={32} className={classes.surface}>
      <Stack gap={4}>
        <Title order={1}>{m.title}</Title>
        <Text c="dimmed">
          {calendar ? `${date(calendar.today)} · ${m.subtitle}` : m.subtitle}
        </Text>
      </Stack>
      {error ? (
        <Alert color={error === 403 ? 'orange' : 'red'} role="alert">
          {error === 403 ? m.forbidden : m.error}
          {error !== 403 && (
            <Button
              onClick={() => setRevision((value) => value + 1)}
              variant="subtle"
              mih={44}
            >
              {m.retry}
            </Button>
          )}
        </Alert>
      ) : !current ? (
        <Stack aria-label={m.loading}>
          <Skeleton height={200} />
          <Skeleton height={160} />
        </Stack>
      ) : (
        <>
          <section aria-labelledby="today-heading" className={classes.today}>
            <Group justify="space-between">
              <Title order={2} size="h3" id="today-heading">
                {m.today}
              </Title>
              <Anchor
                component={Link}
                href={`/diary?date=${current.today}`}
                className={classes.link}
              >
                {m.diary}
              </Anchor>
            </Group>
            <Text className={classes.calories}>
              {number(current.nutrition.today?.calories ?? null)}
              {current.nutrition.today?.calories !== null &&
                current.nutrition.today && (
                  <Text span size="lg" c="dimmed">
                    {' '}
                    {m.kcal}
                  </Text>
                )}
            </Text>
            {current.nutrition.today ? (
              <Group gap={32}>
                {(['protein', 'fat', 'carbs'] as const).map((key) => (
                  <Stack key={key} gap={4}>
                    <Text size="sm" c="dimmed">
                      {m[key]}
                    </Text>
                    <Text fw={600}>
                      {number(current.nutrition.today![key])}
                      {current.nutrition.today![key] !== null
                        ? ` ${m.grams}`
                        : ''}
                    </Text>
                  </Stack>
                ))}
              </Group>
            ) : (
              <Text c="dimmed">{m.todayEmpty}</Text>
            )}
          </section>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={40}>
            <section aria-labelledby="workouts-heading">
              <Stack gap="md">
                <Title order={2} size="h3" id="workouts-heading">
                  {m.workouts}
                </Title>
                {(['planned', 'completed'] as const).map((key) => (
                  <Stack key={key} gap={4}>
                    <Text size="sm" c="dimmed">
                      {m[key]}
                    </Text>
                    {current.workouts[key] ? (
                      <>
                        <Text fw={600}>{current.workouts[key]!.title}</Text>
                        <Text size="sm">
                          {date(current.workouts[key]!.date)}
                        </Text>
                      </>
                    ) : (
                      <Text>
                        {key === 'planned' ? m.noPlan : m.noCompleted}
                      </Text>
                    )}
                  </Stack>
                ))}
                <Anchor
                  component={Link}
                  href="/workouts"
                  className={classes.link}
                >
                  {m.openWorkouts}
                </Anchor>
              </Stack>
            </section>
            <section aria-labelledby="weight-heading">
              <Stack gap="md">
                <Group justify="space-between">
                  <Title order={2} size="h3" id="weight-heading">
                    {m.weight}
                  </Title>
                  <Anchor
                    component={Link}
                    href="/measurements"
                    className={classes.link}
                  >
                    {m.measurements}
                  </Anchor>
                </Group>
                {current.weight.latest ? (
                  <>
                    <Text size="xl" fw={600}>
                      {number(current.weight.latest.value)} {m.kg}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {date(current.weight.latest.date)}
                    </Text>
                  </>
                ) : (
                  <Text c="dimmed">{m.weightEmpty}</Text>
                )}
                <Text size="sm" c="dimmed">
                  {m.trend}
                </Text>
                {current.weight.points.filter(
                  (point) => toChartNumber(point.value) !== null,
                ).length >= 2 ? (
                  <LineChart
                    h={160}
                    data={current.weight.points.map((point) => ({
                      ...point,
                      value: toChartNumber(point.value),
                    }))}
                    dataKey="date"
                    series={[
                      { name: 'value', label: m.weight, color: 'teal.6' },
                    ]}
                    connectNulls={false}
                    withDots
                    withLegend={false}
                    curveType="linear"
                    valueFormatter={(value) =>
                      `${formatDecimal(value) ?? m.empty} ${m.kg}`
                    }
                    xAxisProps={{ tickFormatter: date }}
                    yAxisProps={{ domain: ['dataMin - 1', 'dataMax + 1'] }}
                  />
                ) : (
                  <Text size="sm">{m.noTrend}</Text>
                )}
              </Stack>
            </section>
          </SimpleGrid>
          <Divider />
          <section aria-labelledby="week-heading">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={2} size="h3" id="week-heading">
                  {m.week}
                </Title>
                <Anchor
                  component={Link}
                  href={`/analytics?from=${current.weight.points.at(-7)!.date}&to=${current.today}`}
                  className={classes.link}
                >
                  {m.analytics}
                </Anchor>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <Stack gap={4}>
                  <Text c="dimmed" size="sm">
                    {m.mean}
                  </Text>
                  <Text fw={600} size="xl">
                    {number(current.nutrition.meanCalories)}
                    {current.nutrition.meanCalories !== null
                      ? ` ${m.kcal}`
                      : ''}
                  </Text>
                </Stack>
                <Stack gap={4}>
                  <Text c="dimmed" size="sm">
                    {m.coverage}
                  </Text>
                  <Text fw={600} size="xl">
                    {current.nutrition.recordedDays} / 7
                  </Text>
                </Stack>
                <Stack gap={4}>
                  <Text c="dimmed" size="sm">
                    {m.confirmed}
                  </Text>
                  <Text fw={600} size="xl">
                    {current.nutrition.confirmedDays} / 7
                  </Text>
                  <Text size="sm" c="dimmed">
                    {m.partial}: {current.nutrition.partialDays}
                  </Text>
                </Stack>
              </SimpleGrid>
            </Stack>
          </section>
          {current.sync && (
            <>
              <Divider />
              <Group justify="space-between">
                <Stack gap={4}>
                  <Text fw={600}>{m.sync}</Text>
                  <Group>
                    <Badge
                      variant="light"
                      color={current.sync.hasError ? 'orange' : 'teal'}
                    >
                      {current.sync.running
                        ? m.syncRunning
                        : current.sync.hasError
                          ? m.syncError
                          : current.sync.lastSuccess
                            ? m.syncSuccess
                            : m.syncIdle}
                    </Badge>
                    {current.sync.lastSuccess && (
                      <Text size="sm" c="dimmed">
                        {new Date(current.sync.lastSuccess).toLocaleString(
                          'ru',
                        )}
                      </Text>
                    )}
                  </Group>
                </Stack>
                <Anchor
                  component={Link}
                  href="/settings#sync"
                  className={classes.link}
                >
                  {m.settings}
                </Anchor>
              </Group>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
