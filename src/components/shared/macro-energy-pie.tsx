'use client';
import { PieChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import type { NutritionTotals } from '@/contracts/nutrition';
import { macroEnergyShares } from '@/lib/macro-energy';
import { formatDecimal } from '@/lib/number-display';
import palette from '@/config/nutrient-colors.module.css';
import classes from './macro-energy-pie.module.css';

export function MacroEnergyPie({
  totals,
  labels,
  title,
  unavailable,
  zero,
  withLegend = false,
}: {
  totals: NutritionTotals;
  labels: Record<'protein' | 'fat' | 'carbs', string>;
  title: string;
  unavailable: string;
  zero: string;
  withLegend?: boolean;
}) {
  const shares = macroEnergyShares(totals);
  const hasEnergy = shares?.some((share) => share.percent > 0);
  if (!hasEnergy)
    return (
      <Text size="sm" c="dimmed">
        {shares ? zero : unavailable}
      </Text>
    );
  return (
    <Group gap="md" wrap="wrap" className={palette.palette}>
      <Stack gap="xs" align="center" className={classes.chart}>
        <PieChart
          size={180}
          data={shares!.map(({ key, percent }) => ({
            name: labels[key],
            value: percent,
            color: `var(--nutrient-${key})`,
          }))}
          withTooltip
          valueFormatter={(value) => `${formatDecimal(value)}%`}
          accessibilityLayer
          aria-label={title}
          cellProps={(cell) => ({
            'aria-label': `${cell.name}: ${formatDecimal(cell.value)}%`,
          })}
          pieProps={{ isAnimationActive: false }}
        />
        <Text size="sm" c="dimmed" ta="center">
          {title}
        </Text>
      </Stack>
      {withLegend && (
        <Stack gap="xs">
          {shares!.map(({ key, percent }) => (
            <Text key={key} size="sm">
              <span
                className={classes.swatch}
                aria-hidden="true"
                style={{ background: `var(--nutrient-${key})` }}
              />
              {labels[key]}: {formatDecimal(percent)}%
            </Text>
          ))}
        </Stack>
      )}
    </Group>
  );
}
