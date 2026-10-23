import { SimpleGrid, Stack, Text } from '@mantine/core';
import type { DailyGoals as Goals } from '@/contracts/daily-goals';
import { goalMessages as m } from '@/contracts/daily-goals';
import { formatDecimal } from '@/lib/number-display';
export function DailyGoals({ goals }: { goals: Goals }) {
  return (
    <SimpleGrid
      component="dl"
      cols={{ base: 2, sm: 3 }}
      spacing="md"
      m={0}
      id="goals"
      tabIndex={-1}
      aria-label={m.settingsTitle}
    >
      {(['steps', 'calories', 'weight'] as const).map((key) => (
        <Stack component="div" gap={4} key={key} style={{ minWidth: 0 }}>
          <Text component="dt" size="sm">
            {m[key]}
          </Text>
          <Text
            component="dd"
            m={0}
            fw={600}
            style={{ overflowWrap: 'anywhere' }}
          >
            {formatDecimal(goals[key]) ?? m.missing}
            {goals[key] !== null
              ? ` ${key === 'steps' ? m.stepsUnit : key === 'weight' ? m.kg : m.kcal}`
              : ''}
          </Text>
        </Stack>
      ))}
    </SimpleGrid>
  );
}
