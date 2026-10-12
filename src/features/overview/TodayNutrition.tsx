import { PieChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import type { NutritionTotals } from '@/contracts/nutrition';
import { formatDecimal } from '@/lib/number-display';
import palette from '@/config/nutrient-colors.module.css';
import { macroEnergyShares, macroKeys } from './macro-energy';
import { overviewMessages as m } from './messages';
import classes from './overview.module.css';

export function TodayNutrition({ totals }: { totals: NutritionTotals | null }) {
  const shares = macroEnergyShares(totals);
  const hasEnergy = shares?.some((share) => share.percent > 0);
  return (
    <div className={`${classes.nutrition} ${palette.palette}`}>
      <div>
        <Text className={classes.calories}>
          {formatDecimal(totals?.calories ?? null) ?? m.empty}
          {totals?.calories != null && (
            <Text span size="lg" c="dimmed">
              {' '}
              {m.kcal}
            </Text>
          )}
        </Text>
        {totals ? (
          <Group gap={24} align="flex-start">
            {macroKeys.map((key) => (
              <Stack key={key} gap={4} className={classes.macro}>
                <Text size="sm" c="dimmed">
                  <span
                    className={classes.swatch}
                    style={{ background: `var(--nutrient-${key})` }}
                  />
                  {m[key]}
                </Text>
                <Text fw={600} style={{ color: `var(--nutrient-${key})` }}>
                  {formatDecimal(totals[key]) ?? m.empty}
                  {totals[key] !== null ? ` ${m.grams}` : ''}
                </Text>
                {shares && (
                  <Text size="sm">
                    {formatDecimal(
                      shares.find((share) => share.key === key)!.percent,
                    )}
                    % {m.energyShare}
                  </Text>
                )}
              </Stack>
            ))}
          </Group>
        ) : (
          <Text c="dimmed">{m.todayEmpty}</Text>
        )}
      </div>
      {totals && (
        <Stack gap="xs" align="center" className={classes.chart}>
          {hasEnergy ? (
            <PieChart
              size={180}
              data={shares!.map(({ key, percent }) => ({
                name: m[key],
                value: percent,
                color: `var(--nutrient-${key})`,
              }))}
              withTooltip
              valueFormatter={(value) => `${formatDecimal(value)}%`}
              accessibilityLayer
              aria-label={m.macroChart}
              cellProps={(cell) => ({
                'aria-label': `${cell.name}: ${formatDecimal(cell.value)}%`,
              })}
              pieProps={{ isAnimationActive: false }}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {shares ? m.zeroEnergy : m.macroUnavailable}
            </Text>
          )}
          {hasEnergy && (
            <Text size="sm" c="dimmed" ta="center">
              {m.macroChart}
            </Text>
          )}
        </Stack>
      )}
    </div>
  );
}
