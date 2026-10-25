'use client';
import { GoalComparison } from '@/components/shared/goal-comparison';
import { goalMessages } from '@/contracts/daily-goals';
import { requestOverviewRefresh } from '@/lib/api-client';
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
  Button,
  Group,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
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
      if (!syncTimezone || inFlight || document.visibilityState !== 'visible')
        return;
      inFlight = true;
      setAutomaticPending(true);
      void requestOverviewRefresh(syncTimezone)
        .then(() => revalidateVisibleReads())
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
  const analyticsHref = current
    ? `/analytics?from=${shiftDate(current.today, -6)}&to=${current.today}`
    : '/analytics';
  return (
    <Stack gap="md" className={classes.surface}>
      <Group justify="space-between" gap="sm" className={classes.heading}>
        <PageHeader>{m.title}</PageHeader>
        {(saved || calendar) && (
          <Text size="sm" c="dimmed">
            {date(saved?.today ?? calendar!.today)}
          </Text>
        )}
      </Group>
      {error ? (
        <Alert color="red" role="alert">
          {m.error}
          <Button
            onClick={() => void localRead.refresh()}
            variant="subtle"
            mih={44}
          >
            {m.retry}
          </Button>
        </Alert>
      ) : !current ? (
        <Stack gap={0} aria-label={m.loading}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} height={112} mb={8} />
          ))}
        </Stack>
      ) : (
        <>
          <div className={classes.rows}>
            <Anchor
              renderRoot={(props) => createElement(linkComponent, props)}
              href={`/diary?date=${current.today}`}
              className={`${classes.row} ${classes.foodRow}`}
              underline="never"
            >
              <IconChevronRight
                className={classes.chevron}
                size={18}
                aria-hidden="true"
              />
              <TodayNutrition
                totals={current.nutrition.today}
                goal={current.goals.calories}
              />
            </Anchor>
            <Anchor
              renderRoot={(props) => createElement(linkComponent, props)}
              href={analyticsHref}
              className={classes.row}
              underline="never"
            >
              <IconChevronRight
                className={classes.chevron}
                size={18}
                aria-hidden="true"
              />
              <div className={classes.rowHeading}>
                <Text component="h2" size="md" fw={600} m={0}>
                  {goalMessages.stepsTitle}
                </Text>
                <Text className={classes.value}>
                  {formatDecimal(current.steps) ?? m.empty}
                </Text>
              </div>
              <div className={classes.details}>
                <GoalComparison
                  actual={current.steps}
                  goal={current.goals.steps}
                  unit={goalMessages.stepsUnit}
                  compact
                />
              </div>
            </Anchor>
            <Anchor
              renderRoot={(props) => createElement(linkComponent, props)}
              href="/measurements"
              className={classes.row}
              underline="never"
            >
              <IconChevronRight
                className={classes.chevron}
                size={18}
                aria-hidden="true"
              />
              <div className={classes.rowHeading}>
                <Text component="h2" size="md" fw={600} m={0}>
                  {m.weight}
                </Text>
                <Text className={classes.value}>
                  {current.weight.latest
                    ? `${number(current.weight.latest.value)} ${m.kg}`
                    : m.empty}
                </Text>
              </div>
              <div className={`${classes.details} ${classes.weightDetails}`}>
                {current.weight.latest && (
                  <Text size="sm" c="dimmed">
                    {date(current.weight.latest.date)}
                  </Text>
                )}
                {current.weight.points.filter(
                  (point) => toChartNumber(point.value) !== null,
                ).length >= 2 ? (
                  <div className={classes.trend} aria-hidden="true">
                    <LineChart
                      h={36}
                      data={current.weight.points.map((point) => ({
                        ...point,
                        value: toChartNumber(point.value),
                      }))}
                      dataKey="date"
                      series={[
                        { name: 'value', label: m.weight, color: 'teal.6' },
                      ]}
                      connectNulls
                      gridAxis="none"
                      withXAxis={false}
                      withYAxis={false}
                      withTooltip={false}
                      withLegend={false}
                      withDots={false}
                      accessibilityLayer={false}
                      curveType="linear"
                      yAxisProps={{ domain: ['dataMin - 1', 'dataMax + 1'] }}
                    />
                  </div>
                ) : null}
              </div>
            </Anchor>
            <Anchor
              renderRoot={(props) => createElement(linkComponent, props)}
              href="/workouts"
              className={classes.row}
              underline="never"
            >
              <IconChevronRight
                className={classes.chevron}
                size={18}
                aria-hidden="true"
              />
              <div className={classes.rowHeading}>
                <Text component="h2" size="md" fw={600} m={0}>
                  {m.workouts}
                </Text>
                <Text size="sm" c="dimmed">
                  {current.workouts.planned
                    ? date(current.workouts.planned.date)
                    : m.planned}
                </Text>
              </div>
              <div className={classes.details}>
                <Text fw={600} size="sm" className={classes.workoutTitle}>
                  {current.workouts.planned
                    ? workoutTitle(
                        current.workouts.planned.title,
                        current.workouts.planned.date,
                      )
                    : plannedUnknown
                      ? m.noSavedPlan
                      : m.noPlan}
                </Text>
                <Text size="sm" c="dimmed" className={classes.completed}>
                  {m.completed}:{' '}
                  {current.workouts.completed
                    ? `${workoutTitle(current.workouts.completed.title, current.workouts.completed.date)} · ${date(current.workouts.completed.date)}`
                    : m.noCompleted}
                </Text>
              </div>
            </Anchor>
          </div>
          <footer className={classes.footer}>
            <Anchor
              renderRoot={(props) => createElement(linkComponent, props)}
              href={analyticsHref}
              className={classes.link}
            >
              {m.analytics}
            </Anchor>
            {current.sync && (
              <div className={classes.sync}>
                <Text size="xs" c="dimmed">
                  {m.sync}:{' '}
                  {current.sync.running
                    ? m.syncRunning
                    : current.sync.hasError
                      ? m.syncError
                      : current.sync.lastSuccess
                        ? m.syncSuccess
                        : m.syncIdle}
                  {current.sync.lastSuccess &&
                    ` · ${new Date(current.sync.lastSuccess).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </Text>
                <Anchor
                  renderRoot={(props) => createElement(linkComponent, props)}
                  href="/settings#sync"
                  className={classes.link}
                  size="xs"
                >
                  {m.settings}
                </Anchor>
              </div>
            )}
          </footer>
        </>
      )}
    </Stack>
  );
}
