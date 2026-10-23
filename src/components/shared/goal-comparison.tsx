import Decimal from 'decimal.js';
import { Group, Stack, Text } from '@mantine/core';
import { goalMessages as m } from '@/contracts/daily-goals';
import { formatDecimal } from '@/lib/number-display';
const Exact = Decimal.clone({ precision: 40 });
export function GoalComparison({
  actual,
  goal,
  unit,
}: {
  actual: string | number | null;
  goal: string | number | null;
  unit: string;
}) {
  const difference =
    actual === null || goal === null ? null : new Exact(goal).minus(actual);
  return (
    <Group gap="lg" align="start" wrap="wrap">
      <Stack gap={2}>
        <Text size="sm" c="dimmed">
          {m.goal}
        </Text>
        <Text fw={600}>
          {formatDecimal(goal) ?? m.missing}
          {goal !== null ? ` ${unit}` : ''}
        </Text>
      </Stack>
      <Stack gap={2}>
        <Text size="sm" c="dimmed">
          {difference?.isNegative() ? m.over : m.remaining}
        </Text>
        <Text fw={600}>
          {difference === null
            ? '—'
            : `${formatDecimal(difference.abs().toFixed())} ${unit}`}
        </Text>
      </Stack>
    </Group>
  );
}
