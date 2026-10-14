import { Group, Stack, Text, Title } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconMinus,
} from '@tabler/icons-react';
import type { AnalyticsHighlight } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
import { signed } from './display';
export function AnalyticsHighlights({
  items,
}: {
  items: AnalyticsHighlight[];
}) {
  return (
    <Stack gap="sm" component="section" aria-labelledby="analytics-highlights">
      <Title order={2} id="analytics-highlights">
        {m.highlights}
      </Title>
      {items.length === 0 && <Text c="dimmed">{m.noChanges}</Text>}
      {items.map((item) => {
        const quality =
          item.kind === 'nutritionQuality' || item.kind === 'stepsQuality';
        const Icon = quality
          ? IconAlertTriangle
          : Number(item.value) > 0
            ? IconArrowUpRight
            : Number(item.value) < 0
              ? IconArrowDownRight
              : IconMinus;
        const value = quality ? item.value : signed(item.value);
        const label =
          item.kind === 'weight'
            ? m.highlightWeight(value)
            : item.kind === 'calories'
              ? m.highlightCalories(value)
              : item.kind === 'steps'
                ? m.highlightSteps(value)
                : item.kind === 'nutritionQuality'
                  ? m.highlightNutritionQuality(value)
                  : m.highlightStepsQuality(value);
        return (
          <Group key={item.kind} gap="sm" wrap="nowrap" align="start">
            <Icon
              size={20}
              aria-hidden
              style={{
                flexShrink: 0,
                color: quality
                  ? 'var(--mantine-color-orange-7)'
                  : 'var(--mantine-color-text)',
              }}
            />
            <Text>{label}</Text>
          </Group>
        );
      })}
    </Stack>
  );
}
