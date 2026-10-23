'use client';
import { goalMessages as gm } from '@/contracts/daily-goals';
import { CompositeChart } from '@mantine/charts';
import { Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { AnalyticsData } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
import { dateLabel, display } from './display';
import {
  BlockError,
  ChartTooltip,
  Comparison,
  Details,
  Freshness,
} from './shared';
import classes from './analytics.module.css';
export function ActivityAnalytics({
  block,
  context,
}: {
  block: AnalyticsData['activity'];
  context: Pick<AnalyticsData, 'today' | 'timezone' | 'canSync'>;
}) {
  if (block.state === 'error')
    return (
      <Paper withBorder className={classes.section}>
        <Stack>
          <Title order={2}>{m.activity}</Title>
          <BlockError />
        </Stack>
      </Paper>
    );
  const { summary, updatedAt } = block.data;
  const paired = summary.days.filter(
    (day) =>
      day.date < context.today && day.steps !== null && day.goal !== null,
  );
  const achieved = paired.filter((day) => day.steps! >= day.goal!).length;
  return (
    <Paper
      withBorder
      className={classes.section}
      component="section"
      aria-labelledby="activity-heading"
      data-testid="health-steps"
    >
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2} id="activity-heading">
            {m.activity}
          </Title>
          <Badge variant="light">YAZIO</Badge>
        </Group>
        <Stack gap={4}>
          <Text className={classes.headline}>
            {display(summary.averageSteps)}
            <Text component="span" size="sm" fw={400}>
              {' '}
              {m.stepsPerDay}
            </Text>
          </Text>
          <Comparison
            change={block.comparison}
            unit={m.stepUnit}
            failed={block.comparisonUnavailable}
          />
          <Text c="dimmed" size="sm">
            {display(summary.totalSteps)} {m.totalSteps} ·{' '}
            {m.stepDays(summary.observedDays, summary.days.length)}
          </Text>
        </Stack>
        <Text size="sm">
          {gm.achievement}: {achieved} / {paired.length} {gm.days}
        </Text>
        {summary.observedDays === 0 ? (
          <Text>{m.emptySteps}</Text>
        ) : (
          <CompositeChart
            h={240}
            data={summary.days}
            dataKey="date"
            series={[
              { name: 'steps', label: m.steps, color: 'teal.7', type: 'bar' },
              {
                name: 'goal',
                label: gm.goal,
                color: 'gray.7',
                type: 'line',
                strokeDasharray: '5 5',
              },
            ]}
            connectNulls={false}
            withLegend
            maxBarWidth={32}
            barProps={{ isAnimationActive: false }}
            yAxisProps={{ domain: [0, 'auto'] }}
            xAxisProps={{ tickFormatter: dateLabel, minTickGap: 24 }}
            valueFormatter={display}
            tooltipProps={{
              content: ({ label }) => {
                const day = summary.days.find((day) => day.date === label);
                return day ? (
                  <ChartTooltip
                    date={dateLabel(day.date)}
                    value={day.steps === null ? null : String(day.steps)}
                    unit={m.stepUnit}
                    source={day.source ?? undefined}
                  />
                ) : null;
              },
            }}
          />
        )}
        <Details stateKey="activity">
          <Table.ScrollContainer minWidth={320}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.date}</Table.Th>
                  <Table.Th>{m.steps}</Table.Th>
                  <Table.Th>{m.source}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.days.map((day) => (
                  <Table.Tr key={day.date}>
                    <Table.Td>{day.date}</Table.Td>
                    <Table.Td>
                      {day.steps === null ? m.noData : String(day.steps)}
                    </Table.Td>
                    <Table.Td>{day.source ?? '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Details>
        <Freshness updatedAt={updatedAt} {...context} />
      </Stack>
    </Paper>
  );
}
