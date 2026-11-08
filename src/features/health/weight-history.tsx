'use client';
import {
  Accordion,
  Group,
  Pagination,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import type { WeightHistory } from '@/contracts/health';
import { formatDecimal } from '@/lib/number-display';
import { useViewState } from '@/lib/use-view-state';
import { healthMessages as m } from './messages';

const pageSize = 8;
const weightDate = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeZone: 'UTC',
});

export function WeightHistoryPanel({ history }: { history: WeightHistory }) {
  const [open, setOpen] = useViewState<string | null>(
    'weight:history-open',
    null,
  );
  const [page, setPage] = useViewState('weight:history-page', 1);
  const rows = [
    ...history.local.map((record) => ({
      measuredAt: record.measuredAt,
      value: record.value,
      source: m.local,
    })),
    ...history.imported.map((record) => ({
      measuredAt: record.measuredAt,
      value: record.rawValue,
      source: 'YAZIO',
    })),
  ].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const total = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, total);
  const start = (current - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);

  return (
    <Accordion
      data-testid="health-weight"
      variant="default"
      order={2}
      value={open}
      onChange={setOpen}
    >
      <Accordion.Item value="weight">
        <Accordion.Control mih={52}>
          <Group gap="xs" wrap="wrap">
            <Text component="span" fw={650}>
              {m.weight}
            </Text>
            {rows.length > 0 && (
              <Text component="span" size="sm" c="dimmed">
                {m.weightCount(rows.length)}
              </Text>
            )}
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          {open === 'weight' && (
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {m.ownerConfirmedKgExplanation}
              </Text>
              {rows.length === 0 ? (
                <Text size="sm">{m.emptyWeight}</Text>
              ) : (
                <Table
                  fz="sm"
                  layout="fixed"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  <Table.Caption c="dimmed">
                    {weightDate.format(new Date(history.range.from))} —{' '}
                    {weightDate.format(new Date(history.range.to))}
                  </Table.Caption>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">{m.date}</Table.Th>
                      <Table.Th scope="col">{m.value}</Table.Th>
                      <Table.Th scope="col">{m.source}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visible.map((record, index) => {
                      const value = formatDecimal(record.value);
                      return (
                        <Table.Tr key={start + index}>
                          <Table.Td>
                            <time dateTime={record.measuredAt}>
                              {weightDate.format(new Date(record.measuredAt))}
                            </time>
                          </Table.Td>
                          <Table.Td style={{ overflowWrap: 'anywhere' }}>
                            {value === null
                              ? m.noData
                              : `${value}\u00a0${m.kg}`}
                          </Table.Td>
                          <Table.Td>{record.source}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              )}
              {total > 1 && (
                <Pagination.Root
                  size={44}
                  total={total}
                  value={current}
                  onChange={setPage}
                >
                  <Group justify="space-between" gap="xs">
                    <Text size="sm" c="dimmed" role="status">
                      {m.weightPageRange(
                        start + 1,
                        start + visible.length,
                        rows.length,
                      )}
                    </Text>
                    <Group gap={4}>
                      <Pagination.Previous aria-label={m.weightPreviousPage} />
                      <Pagination.Next aria-label={m.weightNextPage} />
                    </Group>
                  </Group>
                </Pagination.Root>
              )}
            </Stack>
          )}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
