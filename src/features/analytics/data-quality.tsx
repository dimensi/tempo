import { Alert, Paper, Progress, Stack, Text, Title } from '@mantine/core';
import type { AnalyticsData } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
import { Details } from './shared';
import classes from './analytics.module.css';
export function AnalyticsDataQuality({ data }: { data: AnalyticsData }) {
  return (
    <Paper withBorder className={classes.section} component="section">
      <Stack gap="md">
        <Title order={2}>{m.dataQuality}</Title>
        {data.nutrition.state === 'ready' && (
          <>
            <Text>
              {m.filledDays(
                data.nutrition.data.completeDays,
                data.nutrition.data.days.length,
              )}{' '}
              ·{' '}
              {Math.round(
                (data.nutrition.data.completeDays /
                  data.nutrition.data.days.length) *
                  100,
              )}
              %
            </Text>
            <Progress
              value={
                (data.nutrition.data.completeDays /
                  data.nutrition.data.days.length) *
                100
              }
              aria-label={m.dataQuality}
            />
            <Text size="sm" c="dimmed">
              {m.qualityCounts(
                data.nutrition.data.completeDays,
                data.nutrition.data.partialDays,
                data.nutrition.data.emptyDays,
                data.nutrition.data.missingDays,
              )}
            </Text>
            {data.nutrition.data.completeDays <
              data.nutrition.data.days.length && (
              <Alert color="orange">
                {m.qualityWarning(
                  data.nutrition.data.days.length -
                    data.nutrition.data.completeDays,
                )}
              </Alert>
            )}
          </>
        )}
        <Details label={m.methods}>
          <Stack>
            <Text size="sm">{m.methodsText}</Text>
            <Text size="sm">{m.qualityExplanation}</Text>
            <Text size="sm">{m.macroExplanation}</Text>
            <Text size="sm">{m.weightExplanation}</Text>
            <Text size="sm">{m.stepsExplanation}</Text>
            <Text size="sm">{m.comparisonMissing}</Text>
          </Stack>
        </Details>
      </Stack>
    </Paper>
  );
}
