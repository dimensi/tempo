'use client';
import { useState } from 'react';
import { LineChart } from '@mantine/charts';
import {
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  measurementMetrics,
  type MeasurementMetric,
} from '@/contracts/measurements';
import type { AnalyticsBlock, BodyAnalysis } from '@/contracts/analytics';
import { bodyChart } from './measurements';
import { analyticsMessages as m } from './messages';
import { dateLabel, display, signed } from './display';
import { BlockError, ChartTooltip, Details } from './shared';
import classes from './analytics.module.css';
export function BodyAnalytics({
  block,
}: {
  block: AnalyticsBlock<BodyAnalysis>;
}) {
  const [metric, setMetric] = useState<MeasurementMetric>('weight');
  if (block.state === 'error')
    return (
      <Paper withBorder className={classes.section}>
        <Stack>
          <Title order={2}>{m.body}</Title>
          <BlockError />
        </Stack>
      </Paper>
    );
  const current = block.data.metrics[metric];
  const unit = metric === 'weight' ? m.kg : m.cm;
  const select = (value: string | null) => {
    if (measurementMetrics.some((key) => key === value))
      setMetric(value as MeasurementMetric);
  };
  const choices = measurementMetrics.map((value) => ({
    value,
    label: m[value],
  }));
  const chart = bodyChart(current.observations);
  return (
    <Paper
      withBorder
      className={classes.section}
      component="section"
      aria-labelledby="body-heading"
      data-testid="analytics-body"
    >
      <Stack gap="lg">
        <Title order={2} id="body-heading">
          {m.body}
        </Title>
        <div className={classes.metricDesktop}>
          <SegmentedControl
            aria-label={m.metric}
            value={metric}
            onChange={select}
            data={choices}
          />
        </div>
        <div className={classes.metricMobile}>
          <Select
            label={m.metric}
            value={metric}
            onChange={select}
            data={choices}
            allowDeselect={false}
          />
        </div>
        <Group gap="xl" align="start">
          <Stack gap={4} className={classes.stat}>
            <Text fw={600}>{m[metric]}</Text>
            <Text className={classes.headline}>
              {display(current.latest?.value ?? null)} {unit}
            </Text>
            {current.first && current.latest && (
              <Text size="sm" c="dimmed">
                {display(current.first.value)} → {display(current.latest.value)}{' '}
                {unit}
              </Text>
            )}
          </Stack>
          <Stack gap={4} className={classes.stat}>
            <Text>{m.change}</Text>
            <Text fw={600}>
              {signed(current.delta)} {current.delta !== null ? unit : ''}
            </Text>
            {metric === 'weight' && current.weeklyRate !== null && (
              <Text size="sm" c="dimmed">
                {m.rate}: {signed(current.weeklyRate)} {m.kgWeek}
              </Text>
            )}
          </Stack>
          {current.latest && (
            <Stack gap={4}>
              <Text>{m.latestMeasurement}</Text>
              <Text fw={500}>{dateLabel(current.latest.date)}</Text>
            </Stack>
          )}
        </Group>
        {current.ambiguousEndpoints && (
          <Text size="sm">{m.ambiguousWeight}</Text>
        )}
        {chart.length === 0 ? (
          <Text>{m.measurementsEmpty}</Text>
        ) : (
          <LineChart
            h={280}
            data={chart}
            dataKey="time"
            series={
              metric === 'weight'
                ? [
                    { name: 'local', label: m.local, color: 'teal.7' },
                    { name: 'yazio', label: 'YAZIO', color: 'blue.7' },
                  ]
                : [{ name: 'local', label: m.local, color: 'teal.7' }]
            }
            withDots
            withLegend
            dotProps={{ r: 4 }}
            curveType="linear"
            connectNulls={false}
            lineProps={{ isAnimationActive: false }}
            xAxisProps={{
              type: 'number',
              scale: 'time',
              domain: ['dataMin', 'dataMax'],
              tickFormatter: (value: number) =>
                dateLabel(new Date(value).toISOString().slice(0, 10)),
              minTickGap: 24,
            }}
            yAxisProps={{ domain: ['auto', 'auto'] }}
            valueFormatter={(value) => `${display(value)} ${unit}`}
            tooltipProps={{
              content: ({ label }) => {
                const records = current.observations.filter(
                  (record) => Date.parse(record.date) === Number(label),
                );
                return records.length ? (
                  <Stack gap={4}>
                    {records.map((record) => (
                      <ChartTooltip
                        key={record.id}
                        date={dateLabel(record.date)}
                        value={record.value}
                        unit={unit}
                        source={record.source === 'LOCAL' ? m.local : 'YAZIO'}
                      />
                    ))}
                  </Stack>
                ) : null;
              },
            }}
          />
        )}
        <Details label={m.bodyDetails}>
          <Table.ScrollContainer minWidth={360}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.date}</Table.Th>
                  <Table.Th>
                    {m[metric]}, {unit}
                  </Table.Th>
                  <Table.Th>{m.source}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.observations.map((record) => (
                  <Table.Tr key={record.id}>
                    <Table.Td>{record.date}</Table.Td>
                    <Table.Td>{display(record.value)}</Table.Td>
                    <Table.Td>
                      {record.source === 'LOCAL' ? m.local : 'YAZIO'}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Details>
      </Stack>
    </Paper>
  );
}
