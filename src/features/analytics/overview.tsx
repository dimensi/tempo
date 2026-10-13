import { Paper, Stack, Text, Title } from '@mantine/core';
import type { AnalyticsData } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
import { display, signed } from './display';
import { Comparison } from './shared';
import classes from './analytics.module.css';
export function AnalyticsOverview({ data }: { data: AnalyticsData }) {
  const weight =
    data.body.state === 'ready' ? data.body.data.metrics.weight : null;
  return (
    <Paper
      withBorder
      className={classes.section}
      component="section"
      aria-labelledby="analytics-overview"
    >
      <Stack gap="lg">
        <Title order={2} id="analytics-overview">
          {m.overview}
        </Title>
        <div className={classes.overview}>
          <div className={classes.overviewItem}>
            <Text fw={600}>{m.weight}</Text>
            <Text className={classes.headline}>
              {display(weight?.latest?.value ?? null)}
              {weight?.latest ? ' ' + m.kg : ''}
            </Text>
            <Stack gap={4}>
              {weight?.delta !== null && weight?.delta !== undefined ? (
                <Text fw={500}>
                  {signed(weight.delta)} {m.kg}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  {weight?.ambiguousEndpoints
                    ? m.ambiguousWeight
                    : m.insufficientWeight}
                </Text>
              )}
              {weight?.weeklyRate !== null &&
                weight?.weeklyRate !== undefined && (
                  <Text size="sm" c="dimmed">
                    {signed(weight.weeklyRate)} {m.kgWeek}
                  </Text>
                )}
            </Stack>
          </div>
          <div className={classes.overviewItem}>
            <Text fw={600}>{m.nutrition}</Text>
            <div>
              <Text className={classes.headline}>
                {data.nutrition.state === 'ready'
                  ? display(data.nutrition.data.calorieMean)
                  : m.noData}
              </Text>
              <Text size="sm" c="dimmed">
                {m.kcal} · {m.perDay}
              </Text>
            </div>
            {data.nutrition.state === 'ready' && (
              <Comparison
                change={data.nutrition.comparison}
                unit={m.kcal}
                failed={data.nutrition.comparisonUnavailable}
              />
            )}
          </div>
          <div className={classes.overviewItem}>
            <Text fw={600}>{m.activity}</Text>
            <div>
              <Text className={classes.headline}>
                {data.activity.state === 'ready'
                  ? display(data.activity.data.summary.averageSteps)
                  : m.noData}
              </Text>
              <Text size="sm" c="dimmed">
                {m.stepsPerDay}
              </Text>
            </div>
            {data.activity.state === 'ready' && (
              <Comparison
                change={data.activity.comparison}
                unit={m.stepUnit}
                failed={data.activity.comparisonUnavailable}
              />
            )}
          </div>
        </div>
      </Stack>
    </Paper>
  );
}
