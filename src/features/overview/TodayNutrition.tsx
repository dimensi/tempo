import { MacroEnergyPie } from '@/components/shared/macro-energy-pie';
import { Group, Stack, Text } from '@mantine/core';
import type { NutritionTotals } from '@/contracts/nutrition';
import { formatDecimal } from '@/lib/number-display';
import palette from '@/config/nutrient-colors.module.css';
import { macroEnergyShares, macroKeys } from '@/lib/macro-energy';
import { overviewMessages as m } from './messages';
import classes from './overview.module.css';

export function TodayNutrition({ totals }: { totals: NutritionTotals | null }) {
  const shares = macroEnergyShares(totals);
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
          <MacroEnergyPie
            totals={totals}
            labels={m}
            title={m.macroChart}
            unavailable={m.macroUnavailable}
            zero={m.zeroEnergy}
          />
        </Stack>
      )}
    </div>
  );
}
