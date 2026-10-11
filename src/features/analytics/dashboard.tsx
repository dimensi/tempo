'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { LineChart } from '@mantine/charts';
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { AnalyticsSummary, AnalyticsRange } from '@/contracts/analytics';
import { analyticsRangeSchema } from '@/contracts/analytics';
import {
  measurementMetrics,
  type Measurement,
  type MeasurementMetric,
} from '@/contracts/measurements';
import { presetRange } from './range';
import { analyticsMessages as m } from './messages';
import { nutrients } from './summary';
const display = (value: string | null) =>
  value === null
    ? m.noData
    : new Decimal(value)
        .toDecimalPlaces(2)
        .toNumber()
        .toLocaleString('ru-RU', { maximumFractionDigits: 2 });
export function AnalyticsDashboard({
  summary,
  measurements,
  today,
}: {
  summary: AnalyticsSummary;
  measurements: Pick<Measurement, 'id' | 'measuredAt' | 'values'>[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useState(summary.range);
  const [error, setError] = useState(false);
  const [metric, setMetric] = useState<MeasurementMetric>('weight');
  function navigate(next: AnalyticsRange) {
    const parsed = analyticsRangeSchema.safeParse(next);
    setError(!parsed.success);
    if (!parsed.success) return;
    setRange(parsed.data);
    startTransition(() =>
      router.push(`/analytics?from=${next.from}&to=${next.to}`),
    );
  }
  const points = measurements.flatMap((record) => {
    const value = record.values.find((value) => value.metric === metric);
    return value
      ? [
          {
            date: record.measuredAt,
            value: Number(value.value),
            exact: value.value,
            id: record.id,
          },
        ]
      : [];
  });
  const unit = metric === 'weight' ? m.kg : m.cm;
  return (
    <Stack gap="lg" style={{ minWidth: 0 }}>
      <div>
        <Title order={1}>{m.title}</Title>
        <Text c="dimmed">{m.description}</Text>
      </div>
      <Paper withBorder p="md">
        <Stack>
          <Group>
            <Button
              variant="light"
              disabled={pending}
              onClick={() => navigate(presetRange('week', today))}
            >
              {m.week}
            </Button>
            <Button
              variant="light"
              disabled={pending}
              onClick={() => navigate(presetRange('month', today))}
            >
              {m.month}
            </Button>
            <Text>{m.custom}</Text>
          </Group>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              navigate(range);
            }}
          >
            <Group align="end">
              <TextInput
                type="date"
                label={m.from}
                value={range.from}
                onChange={(event) =>
                  setRange({ ...range, from: event.currentTarget.value })
                }
                required
                style={{ flex: '1 1 150px' }}
              />
              <TextInput
                type="date"
                label={m.to}
                value={range.to}
                onChange={(event) =>
                  setRange({ ...range, to: event.currentTarget.value })
                }
                required
                style={{ flex: '1 1 150px' }}
              />
              <Button mih={44} type="submit" loading={pending}>
                {m.apply}
              </Button>
            </Group>
          </form>
          {error && (
            <Alert color="red" role="alert">
              {m.rangeError}
            </Alert>
          )}
          <Text aria-live="polite">
            {summary.range.from} — {summary.range.to}
          </Text>
        </Stack>
      </Paper>
      <Text>
        {m.coverage}: {summary.recordedDays} / {summary.calendarDays}.{' '}
        {m.missing}: {summary.calendarDays - summary.recordedDays}.
      </Text>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        {nutrients.map((key) => (
          <Paper key={key} withBorder p="md">
            <Stack gap="xs">
              <Text fw={600}>{m[key]}</Text>
              <Text size="xl">
                {display(summary.nutrients[key].mean)}{' '}
                {key === 'calories' ? m.kcal : m.grams}
              </Text>
              <Text size="sm">{m.mean}</Text>
              <Text size="sm">
                {m.confirmed}: {summary.nutrients[key].confirmedDays} /{' '}
                {summary.calendarDays}
              </Text>
              <Text size="sm">
                {m.partial}: {summary.nutrients[key].partialDays}
              </Text>
              <Text size="sm">
                {m.total}: {display(summary.nutrients[key].total)}
              </Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
      <Text size="sm" c="dimmed">
        {m.explanation}
      </Text>
      <Paper withBorder p="md">
        <Stack>
          <Title order={2}>{m.intake}</Title>
          {summary.recordedDays === 0 ? (
            <Text>{m.empty}</Text>
          ) : (
            <>
              <LineChart
                h={260}
                data={summary.days.map((day) => ({
                  date: day.date,
                  calories:
                    day.totals.calories === null
                      ? null
                      : Number(day.totals.calories),
                }))}
                dataKey="date"
                series={[
                  { name: 'calories', label: m.calories, color: 'blue.6' },
                ]}
                connectNulls={false}
                curveType="linear"
                valueFormatter={(value) =>
                  `${value.toLocaleString('ru-RU')} ${m.kcal}`
                }
              />
              <Table.ScrollContainer minWidth={460}>
                <Table captionSide="bottom">
                  <Table.Caption>{m.explanation}</Table.Caption>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{m.date}</Table.Th>
                      <Table.Th>{m.full}</Table.Th>
                      <Table.Th>{m.known}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.days.map((day) => (
                      <Table.Tr key={day.date}>
                        <Table.Td>{day.date}</Table.Td>
                        <Table.Td>{display(day.totals.calories)}</Table.Td>
                        <Table.Td>
                          {day.totals.calories === null
                            ? display(day.knownTotals.calories)
                            : '—'}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack>
          <Title order={2}>{m.measurements}</Title>
          <Select
            label={m.metric}
            value={metric}
            onChange={(value) => {
              if (value) setMetric(value as MeasurementMetric);
            }}
            data={measurementMetrics.map((value) => ({
              value,
              label: m[value],
            }))}
            allowDeselect={false}
          />
          {points.length === 0 ? (
            <Text>{m.measurementsEmpty}</Text>
          ) : (
            <>
              <LineChart
                h={240}
                data={points}
                dataKey="date"
                series={[
                  {
                    name: 'value',
                    label: m[metric],
                    color: 'teal.6',
                  },
                ]}
                curveType="linear"
                connectNulls={false}
                valueFormatter={(value) =>
                  `${value.toLocaleString('ru-RU')} ${unit}`
                }
              />
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{m.date}</Table.Th>
                    <Table.Th>
                      {m[metric]}, {unit}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {points.map((point) => (
                    <Table.Tr key={point.id}>
                      <Table.Td>{point.date}</Table.Td>
                      <Table.Td>{display(point.exact)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
