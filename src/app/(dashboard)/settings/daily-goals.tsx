import { Group, Stack, Text } from '@mantine/core';
import type { DailyGoals as Goals } from '@/contracts/daily-goals';
import { goalMessages as m } from '@/contracts/daily-goals';
import { formatDecimal } from '@/lib/number-display';
export function DailyGoals({ goals }: { goals: Goals }) {
  return (
    <Stack gap="sm" component="section" id="goals" aria-label={m.settingsTitle}>
      {(['steps', 'calories'] as const).map((key) => (
        <Group key={key} justify="space-between">
          <Text>{m[key]}</Text>
          <Text fw={600}>
            {formatDecimal(goals[key]) ?? m.missing}
            {goals[key] !== null
              ? ` ${key === 'steps' ? m.stepsUnit : m.kcal}`
              : ''}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}
