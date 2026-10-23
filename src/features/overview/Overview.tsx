'use client';
import { GoalComparison } from '@/components/shared/goal-comparison';
import { goalMessages } from '@/contracts/daily-goals';
import { apiResults } from '@/lib/api-results';
import { apiFetch } from '@/lib/api-client';
import { revalidateVisibleReads } from '@/lib/client-read';
import { PageHeader } from '@/components/layout/page-header';
import type { OverviewData } from '@/contracts/overview';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { formatDecimal, toChartNumber } from '@/lib/number-display';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { workoutTitle } from '@/lib/workout-title';
import { LineChart } from '@mantine/charts';
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
import Link from 'next/link';
import {
  createElement,
  useEffect,
  useState,
  useRef,
  type ElementType,
} from 'react';
import { localCalendar, nextMidnightDelay } from './calendar';
import { overviewMessages as m } from './messages';
import classes from './overview.module.css';
import { TodayNutrition } from './TodayNutrition';
const number = (value: string | null) => formatDecimal(value) ?? m.empty;
const date = (value: string) =>
  new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(
    new Date(`${value}T12:00:00`),
  );
export function Overview({
  saved,
  plannedUnknown = false,
  linkComponent = Link,
}: {
  saved?: OverviewData;
  plannedUnknown?: boolean;
  linkComponent?: ElementType;
} = {}) {
  const [calendar, setCalendar] = useState<ReturnType<
    typeof localCalendar
  > | null>(null);
  const localRead = useReadResource(
    readResources.overview(
      calendar
        ? `/api/overview?timezone=${encodeURIComponent(calendar.timezone)}`
        : undefined,
    ),
  );
  const refreshResource = localRead.refresh;
  useEffect(() => {
    if (saved) return;
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      const next = localCalendar();
      setCalendar((current) =>
        current?.today === next.today && current.timezone === next.timezone
          ? current
          : next,
      );
      clearTimeout(timer);
      timer = setTimeout(refresh, nextMidnightDelay());
    }
    function refresh() {
      update();
      void refreshResource();
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
  }, [saved, refreshResource]);
  const data = localRead.data;
  const error = data ? null : localRead.error ? 500 : null;
  const current =
    saved ??
    (data &&
    data.today === calendar?.today &&
    data.timezone === calendar.timezone
      ? data
      : null);
  const [automaticPending, setAutomaticPending] = useState(false);
  const owner = !saved && !!current?.sync;
  const syncTimezone = calendar?.timezone;
  const syncToday = calendar?.today;
  useEffect(() => {
    if (!owner || !syncTimezone) return;
    let inFlight = false;
    function sync() {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      setAutomaticPending(true);
      void apiFetch('/api/yazio/overview-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: syncTimezone }),
      })
        .then(async (response) => {
          if (response.ok) {
            apiResults.overviewRefresh(await response.json());
            revalidateVisibleReads();
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
          setAutomaticPending(false);
        });
    }
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [owner, syncToday, syncTimezone]);
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = !!current?.sync?.running;
    if (wasRunning.current && !running) revalidateVisibleReads();
    wasRunning.current = running;
  }, [current?.sync?.running]);
  useEffect(() => {
    if (!current?.sync?.running && !automaticPending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refreshResource();
      if (!disposed && document.visibilityState === 'visible')
        timer = setTimeout(() => void poll(), 2000);
    }
    function visible() {
      clearTimeout(timer);
      if (document.visibilityState === 'visible')
        timer = setTimeout(() => void poll(), 2000);
    }
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [current?.sync?.running, automaticPending, refreshResource]);
  return (
    <Stack gap={32} className={classes.surface}>
      <Stack gap={4}>
        <PageHeader>{m.title}</PageHeader>
        <Text c="dimmed">
          {saved || calendar
            ? `${date(saved?.today ?? calendar!.today)} · ${m.subtitle}`
            : m.subtitle}
        </Text>
      </Stack>
      {error ? (
        <Alert color="red" role="alert">
          {m.error}
          {
            <Button
              onClick={() => void localRead.refresh()}
              variant="subtle"
              mih={44}
            >
              {m.retry}
            </Button>
          }
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
                renderRoot={(props) => createElement(linkComponent, props)}
                href={`/diary?date=${current.today}`}
                className={classes.link}
              >
                {m.diary}
              </Anchor>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
              <Stack>
                <TodayNutrition totals={current.nutrition.today} />
                <GoalComparison
                  actual={current.nutrition.today?.calories ?? null}
                  goal={current.goals.calories}
                  unit={m.kcal}
                />
              </Stack>
              <Stack gap="md">
                <Title order={3}>{goalMessages.stepsTitle}</Title>
                <Text className={classes.stepsValue}>
                  {formatDecimal(current.steps) ?? m.empty}
                </Text>
                <GoalComparison
                  actual={current.steps}
                  goal={current.goals.steps}
                  unit={goalMessages.stepsUnit}
                />
              </Stack>
            </SimpleGrid>
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
                        <Text fw={600}>
                          {workoutTitle(
                            current.workouts[key]!.title,
                            current.workouts[key]!.date,
                          )}
                        </Text>
                        <Text size="sm">
                          {date(current.workouts[key]!.date)}
                        </Text>
                      </>
                    ) : (
                      <Text>
                        {key === 'planned'
                          ? plannedUnknown
                            ? m.noSavedPlan
                            : m.noPlan
                          : m.noCompleted}
                      </Text>
                    )}
                  </Stack>
                ))}
                <Anchor
                  renderRoot={(props) => createElement(linkComponent, props)}
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
                    renderRoot={(props) => createElement(linkComponent, props)}
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
                    connectNulls
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
                  renderRoot={(props) => createElement(linkComponent, props)}
                  href={`/analytics?from=${shiftDate(current.today, -6)}&to=${current.today}`}
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
                  renderRoot={(props) => createElement(linkComponent, props)}
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
