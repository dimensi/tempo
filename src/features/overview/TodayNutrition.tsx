import { GoalComparison } from '@/components/shared/goal-comparison';
import { Group, Text } from '@mantine/core';
import type { NutritionTotals } from '@/contracts/nutrition';
import { formatDecimal } from '@/lib/number-display';
import palette from '@/config/nutrient-colors.module.css';
import { macroKeys } from '@/lib/macro-energy';
import { overviewMessages as m } from './messages';
import classes from './overview.module.css';

export function TodayNutrition({
  totals,
  goal,
}: {
  totals: NutritionTotals | null;
  goal: string | number | null;
}) {
  return (
    <div className={palette.palette}>
      <div className={classes.rowHeading}>
        <Text component="h2" size="md" fw={600} m={0}>
          {m.today}
        </Text>
        <Text className={classes.calories}>
          {formatDecimal(totals?.calories ?? null) ?? m.empty}
          {totals?.calories != null && (
            <Text span size="sm">
              {' '}
              {m.kcal}
            </Text>
          )}
        </Text>
      </div>
      <div className={classes.details}>
        <GoalComparison
          actual={totals?.calories ?? null}
          goal={goal}
          unit={m.kcal}
          compact
        />
        {totals ? (
          <Group gap="md" wrap="wrap" className={classes.macros}>
            {macroKeys.map((key) => (
              <Text
                key={key}
                size="sm"
                title={m[key]}
                aria-label={`${m[key]} ${formatDecimal(totals[key]) ?? m.empty}${totals[key] !== null ? ` ${m.grams}` : ''}`}
                style={{ color: `var(--nutrient-${key})` }}
              >
                {m.macroAbbreviations[key]}{' '}
                {formatDecimal(totals[key]) ?? m.empty}
                {totals[key] !== null ? ` ${m.grams}` : ''}
              </Text>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            {m.todayEmpty}
          </Text>
        )}
      </div>
    </div>
  );
}
