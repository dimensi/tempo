'use client';
import { useState } from 'react';
import { LineChart } from '@mantine/charts';
import {
  NativeSelect,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import type { ProgressStats } from '@/contracts/exercise-progress';
import { progressMessages as m } from './messages';
import { dateLabel, numberLabel, setLabel } from './format';
import styles from './progress.module.css';

export function ProgressChart({ points }: { points: ProgressStats[] }) {
  const [metric, setMetric] = useState('weight');
  const latest = points.at(-1)?.best;
  const [weight, setWeight] = useState(String(latest?.weightKg ?? 'none'));
  const weights = [
    ...new Set(
      points.flatMap((point) =>
        point.repetitions.map((set) => String(set.weightKg ?? 'none')),
      ),
    ),
  ].sort((a, b) => Number(b) - Number(a));
  const selectedWeight = weights.includes(weight) ? weight : weights[0];
  const unit =
    metric === 'weight' ? m.kg : metric === 'reps' ? m.repsUnit : m.volumeUnit;
  return (
    <Stack gap="md" className={styles.chart}>
      <SegmentedControl
        fullWidth
        aria-label={m.metric}
        value={metric}
        onChange={setMetric}
        data={[
          { value: 'weight', label: m.weight },
          { value: 'reps', label: m.reps },
          { value: 'volume', label: m.volume },
        ]}
      />
      {metric === 'reps' && (
        <NativeSelect
          label={m.atWeight}
          value={selectedWeight ?? ''}
          onChange={(event) => setWeight(event.currentTarget.value)}
          data={weights.map((value) => ({
            value,
            label:
              value === 'none'
                ? m.noWeight
                : `${numberLabel(Number(value))} ${m.kg}`,
          }))}
        />
      )}
      {(['LOCAL', 'TransformMate'] as const).map((source) => {
        const rows = points.filter((point) => point.source === source);
        if (!rows.length) return null;
        const data = rows.map((point) => ({
          ...point,
          value:
            metric === 'weight'
              ? (point.best?.weightKg ?? null)
              : metric === 'volume'
                ? point.volume
                : (point.repetitions.find(
                    (set) => String(set.weightKg ?? 'none') === selectedWeight,
                  )?.reps ?? null),
        }));
        const observed = data.filter((point) => point.value !== null).length;
        return (
          <Stack key={source} gap="xs">
            <Text fw={600} size="sm">
              {m.source[source]} · {unit}
            </Text>
            {observed ? (
              <>
                <LineChart
                  h={190}
                  style={{ '--chart-text-color': 'var(--progress-muted)' }}
                  data={data}
                  dataKey="key"
                  series={[
                    {
                      name: 'value',
                      label: m[metric as 'weight' | 'reps' | 'volume'],
                      color: source === 'LOCAL' ? 'teal.7' : 'blue.6',
                    },
                  ]}
                  connectNulls={false}
                  curveType="linear"
                  withDots
                  dotProps={{ r: 4 }}
                  lineProps={{ isAnimationActive: false }}
                  xAxisProps={{
                    tickFormatter: (key: string) =>
                      dateLabel(
                        data.find((point) => point.key === key)?.date ??
                          rows[0]!.date,
                      ),
                    minTickGap: 35,
                  }}
                  yAxisProps={{ domain: [0, 'auto'] }}
                  valueFormatter={numberLabel}
                  tooltipProps={{
                    content: ({ label }) => {
                      const point = data.find(
                        (row) => row.key === String(label),
                      );
                      return point ? (
                        <Paper withBorder p="sm">
                          <Text size="sm" fw={600}>
                            {dateLabel(point.date)}
                          </Text>
                          <Text size="sm">
                            {point.value === null
                              ? '—'
                              : `${numberLabel(point.value)} ${unit}`}
                          </Text>
                          {metric === 'weight' && point.best && (
                            <Text size="sm">{setLabel(point.best)}</Text>
                          )}
                        </Paper>
                      ) : null;
                    },
                  }}
                />
                {observed === 1 && (
                  <Text size="sm" c="var(--progress-muted)">
                    {m.single}
                  </Text>
                )}
              </>
            ) : (
              <Text size="sm" c="var(--progress-muted)">
                {m.noChart}
              </Text>
            )}
          </Stack>
        );
      })}
      {!points.length && (
        <Text size="sm" c="var(--progress-muted)">
          {m.noChart}
        </Text>
      )}
    </Stack>
  );
}
