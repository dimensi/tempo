'use client';
import { useId } from 'react';
import { BarChart } from '@mantine/charts';
import { Box, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type {
  AnalyticsBlock,
  AnalyticsData,
  DayQuality,
  NutritionAnalysis,
} from '@/contracts/analytics';
import { toChartNumber } from '@/lib/number-display';
import { analyticsMessages as m } from './messages';
import { dateLabel, display } from './display';
import { nutritionChart } from './nutrition-chart';
import {
  BlockError,
  ChartTooltip,
  Comparison,
  Details,
  Freshness,
} from './shared';
import classes from './analytics.module.css';
const qualityLabel: Record<DayQuality, string> = {
  complete: m.complete,
  partial: m.incomplete,
  empty: m.emptyDay,
  missing: m.missingDay,
};
const macroKeys = ['protein', 'fat', 'carbs'] as const;
const colors = { protein: 'teal.7', fat: 'orange.7', carbs: 'blue.7' };
export function MacroDistribution({ data }: { data: NutritionAnalysis }) {
  const hasShares = macroKeys.every(
    (key) => data.macros.energyShares[key] !== null,
  );
  return (
    <Stack gap="md">
      <Title order={3}>{m.macroTitle}</Title>
      <Text size="sm" c="dimmed">
        {m.macroDescription}
      </Text>
      {data.macros.days === 0 ? (
        <Text>{m.macroEmpty}</Text>
      ) : (
        <>
          {macroKeys.map((key) => (
            <Group key={key} justify="space-between">
              <Group gap="xs">
                <Box
                  w={10}
                  h={10}
                  bg={colors[key]}
                  style={{ borderRadius: 2 }}
                />
                <Text>{m[key]}</Text>
              </Group>
              <Text fw={600}>
                {display(data.macros.energyShares[key])}
                {hasShares ? '%' : ''} · {display(data.macros.averages[key])}{' '}
                {m.grams}
              </Text>
            </Group>
          ))}
          {hasShares ? (
            <Box
              className={classes.macroBar}
              role="img"
              aria-label={macroKeys
                .map(
                  (key) =>
                    `${m[key]} ${display(data.macros.energyShares[key])}%`,
                )
                .join(', ')}
            >
              {macroKeys.map((key) => (
                <Box
                  key={key}
                  className={classes.macroSegment}
                  bg={colors[key]}
                  style={{
                    width: `${toChartNumber(data.macros.energyShares[key]) ?? 0}%`,
                  }}
                />
              ))}
            </Box>
          ) : (
            <Text size="sm">{m.ratioEmpty}</Text>
          )}
        </>
      )}
      <Text size="sm" c="dimmed">
        {m.macroDays(data.macros.days, data.days.length)}
      </Text>
    </Stack>
  );
}
export function NutritionAnalytics({
  block,
  context,
}: {
  block: AnalyticsBlock<NutritionAnalysis>;
  context: Pick<AnalyticsData, 'timezone' | 'today' | 'canSync'>;
}) {
  const patternId = `partial-${useId().replaceAll(':', '')}`;
  if (block.state === 'error')
    return (
      <Paper withBorder className={classes.section}>
        <Stack>
          <Title order={2}>{m.nutrition}</Title>
          <BlockError />
        </Stack>
      </Paper>
    );
  const data = block.data;
  const chart = nutritionChart(data.days);
  const mean = toChartNumber(data.calorieMean);
  return (
    <Paper
      withBorder
      className={classes.section}
      component="section"
      aria-labelledby="nutrition-heading"
      data-testid="analytics-nutrition"
    >
      <Stack gap="lg">
        <Group justify="space-between" align="start">
          <Stack gap={4}>
            <Title order={2} id="nutrition-heading">
              {m.nutrition}
            </Title>
            <Text className={classes.headline}>
              {display(data.calorieMean)} {m.kcal}
              <Text component="span" size="sm" fw={400}>
                {' '}
                / {m.dailyUnit}
              </Text>
            </Text>
            <Comparison
              change={block.comparison}
              unit={m.kcal}
              failed={block.comparisonUnavailable}
            />
            <Text size="sm" c="dimmed">
              {m.meanDays(data.calorieDays)}
            </Text>
          </Stack>
          <Text size="sm">
            {m.filledDays(data.completeDays, data.days.length)}
          </Text>
        </Group>
        <div className={classes.nutritionGrid}>
          <Stack className={classes.chart}>
            <Title order={3}>{m.intake}</Title>
            {data.calorieDays + data.partialDays === 0 ? (
              <Text>{m.empty}</Text>
            ) : (
              <BarChart
                h={280}
                data={chart}
                dataKey="date"
                type="stacked"
                maxBarWidth={32}
                series={[
                  { name: 'complete', label: m.calories, color: 'teal.7' },
                  {
                    name: 'partial',
                    label: m.known,
                    color: `url(#${patternId})`,
                  },
                ]}
                barProps={{ isAnimationActive: false }}
                valueFormatter={(value) => `${display(value)} ${m.kcal}`}
                xAxisProps={{ tickFormatter: dateLabel, minTickGap: 24 }}
                referenceLines={
                  mean === null
                    ? []
                    : [
                        {
                          y: mean,
                          label: m.averageLine,
                          color: 'gray.6',
                          strokeDasharray: '4 4',
                        },
                      ]
                }
                tooltipProps={{
                  content: ({ label }) => {
                    const day = data.days.find((day) => day.date === label);
                    return day ? (
                      <ChartTooltip
                        date={dateLabel(day.date)}
                        value={
                          day.quality === 'empty' || day.quality === 'missing'
                            ? null
                            : (day.totals.calories ?? day.knownTotals.calories)
                        }
                        unit={
                          day.totals.calories === null &&
                          day.quality === 'partial'
                            ? `+ ${m.kcal}`
                            : m.kcal
                        }
                        status={qualityLabel[day.quality]}
                      />
                    ) : null;
                  },
                }}
              >
                <defs>
                  <pattern
                    id={patternId}
                    patternUnits="userSpaceOnUse"
                    width={6}
                    height={6}
                  >
                    <rect
                      width={6}
                      height={6}
                      fill="var(--mantine-color-gray-2)"
                    />
                    <path
                      d="M0 6L6 0"
                      stroke="var(--mantine-color-teal-7)"
                      strokeWidth={2}
                    />
                  </pattern>
                </defs>
              </BarChart>
            )}
            <Text size="sm" c="dimmed">
              {m.complete} — {m.calories.toLowerCase()};{' '}
              {m.incomplete.toLowerCase()} — {m.known.toLowerCase()}.
            </Text>
          </Stack>
          <MacroDistribution data={data} />
        </div>
        <Details stateKey="nutrition">
          <Table.ScrollContainer minWidth={650}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  {[
                    m.date,
                    m.calories,
                    m.protein,
                    m.fat,
                    m.carbs,
                    m.status,
                  ].map((label) => (
                    <Table.Th key={label}>{label}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.days.map((day) => (
                  <Table.Tr key={day.date}>
                    <Table.Td>{day.date}</Table.Td>
                    {(['calories', 'protein', 'fat', 'carbs'] as const).map(
                      (key) => (
                        <Table.Td key={key}>
                          {day.totals[key] !== null
                            ? display(day.totals[key])
                            : day.quality === 'partial' &&
                                day.knownTotals[key] !== null
                              ? `≥ ${display(day.knownTotals[key])}`
                              : m.noData}
                        </Table.Td>
                      ),
                    )}
                    <Table.Td>{qualityLabel[day.quality]}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Details>
        <Freshness updatedAt={data.updatedAt} {...context} />
      </Stack>
    </Paper>
  );
}
