'use client';
import { LineChart } from '@mantine/charts';
import { Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { StepsSummary } from '@/contracts/health';
import { formatDecimal } from '@/lib/number-display';
import { healthMessages as m } from './messages';

export function StepsPanel({
  summary,
  compact = false,
}: {
  summary: StepsSummary;
  compact?: boolean;
}) {
  const latest = summary.days.at(-1);
  return (
    <Paper withBorder p="md" style={{ minWidth: 0 }} data-testid="health-steps">
      <Stack>
        <Group justify="space-between">
          <Title order={2}>{m.steps}</Title>
          <Badge
            size="lg"
            variant="outline"
            style={{
              fontSize: 16,
              color: 'var(--mantine-color-text)',
              borderColor: 'var(--mantine-color-text)',
            }}
          >
            YAZIO
          </Badge>
        </Group>
        <Text>
          {summary.range.from} — {summary.range.to}
        </Text>
        {compact && (
          <Text>
            {m.today} ({latest?.date}):{' '}
            {formatDecimal(latest?.steps ?? null) ?? m.noData}
          </Text>
        )}
        <Text>
          {m.total}: {formatDecimal(summary.totalSteps) ?? m.noData}
        </Text>
        <Text>
          {m.average}: {formatDecimal(summary.averageSteps) ?? m.noData}
        </Text>
        <Text>
          {m.coverage}: {summary.observedDays} / {summary.days.length}
        </Text>
        {summary.observedDays === 0 ? (
          <Text>{m.emptySteps}</Text>
        ) : (
          <LineChart
            h={compact ? 180 : 240}
            data={summary.days}
            dataKey="date"
            series={[{ name: 'steps', label: m.steps, color: 'blue.7' }]}
            connectNulls={false}
            curveType="linear"
            withDots
            xAxisProps={{
              tick: { fontSize: 16, fill: 'var(--mantine-color-text)' },
            }}
            yAxisProps={{
              tick: { fontSize: 16, fill: 'var(--mantine-color-text)' },
              domain: [0, 'auto'],
            }}
            valueFormatter={(value) => formatDecimal(value) ?? m.noData}
            style={{ minWidth: 0, fontSize: 16 }}
          />
        )}
        <Text>{m.explanation}</Text>
        {!compact && (
          <Table.ScrollContainer minWidth={300}>
            <Table style={{ fontSize: 16 }}>
              <Table.Caption
                style={{ fontSize: 16, color: 'var(--mantine-color-text)' }}
              >
                {m.steps}: {summary.range.from} — {summary.range.to}
              </Table.Caption>
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
        )}
      </Stack>
    </Paper>
  );
}
