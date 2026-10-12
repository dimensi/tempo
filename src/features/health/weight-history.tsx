'use client';
import { Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { WeightHistory } from '@/contracts/health';
import { formatDecimal } from '@/lib/number-display';
import { healthMessages as m } from './messages';

export function WeightHistoryPanel({ history }: { history: WeightHistory }) {
  const rows = [
    ...history.local.map((record) => ({
      measuredAt: record.measuredAt,
      value: record.value,
      source: record.source,
      unit: m.kg,
    })),
    ...history.imported.map((record) => ({
      measuredAt: record.measuredAt,
      value: record.rawValue,
      source: record.source,
      unit: m.unknownUnit,
    })),
  ].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  return (
    <Paper
      withBorder
      p="md"
      style={{ minWidth: 0 }}
      data-testid="health-weight"
    >
      <Stack>
        <Group justify="space-between">
          <Title order={2}>{m.weight}</Title>
        </Group>
        <Text>{m.unknownExplanation}</Text>
        {rows.length === 0 ? (
          <Text>{m.emptyWeight}</Text>
        ) : (
          <Table.ScrollContainer minWidth={300}>
            <Table style={{ fontSize: 16 }}>
              <Table.Caption
                style={{ fontSize: 16, color: 'var(--mantine-color-text)' }}
              >
                {m.weight}: {history.range.from} — {history.range.to}
              </Table.Caption>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.date}</Table.Th>
                  <Table.Th>{m.value}</Table.Th>
                  <Table.Th style={{ width: 100 }}>{m.source}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((record, index) => (
                  <Table.Tr key={`${record.measuredAt}:${index}`}>
                    <Table.Td>{record.measuredAt}</Table.Td>
                    <Table.Td style={{ overflowWrap: 'anywhere' }}>
                      {formatDecimal(record.value) ?? m.noData}
                      <Text>{record.unit}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="lg"
                        variant="outline"
                        styles={{
                          label: {
                            flexShrink: 0,
                            overflow: 'visible',
                            textOverflow: 'clip',
                          },
                        }}
                        style={{
                          fontSize: 16,
                          textTransform: 'none',
                          maxWidth: 'none',
                          color: 'var(--mantine-color-text)',
                          borderColor: 'var(--mantine-color-text)',
                        }}
                      >
                        {record.source === 'LOCAL' ? m.local : 'YAZIO'}
                      </Badge>
                    </Table.Td>
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
