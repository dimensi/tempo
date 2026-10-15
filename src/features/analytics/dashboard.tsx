'use client';
import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import type { AnalyticsData } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
import { PeriodControl } from './period-control';
import { AnalyticsOverview } from './overview';
import { AnalyticsHighlights } from './highlights';
import { NutritionAnalytics } from './nutrition-analytics';
import { BodyAnalytics } from './body-analytics';
import { ActivityAnalytics } from './activity-analytics';
import { AnalyticsDataQuality } from './data-quality';
import classes from './analytics.module.css';
export function AnalyticsDashboard({
  data,
  navigationSlot,
}: {
  data: AnalyticsData;
  navigationSlot?: ReactNode;
}) {
  const context = {
    today: data.today,
    timezone: data.timezone,
    canSync: data.canSync,
  };
  return (
    <Stack gap="xl" className={classes.root}>
      <Stack gap="md">
        <div>
          <Title order={1}>{m.title}</Title>
          <Text c="dimmed">{m.description}</Text>
        </div>
        {navigationSlot ?? (
          <PeriodControl
            range={data.range}
            previous={data.previousRange}
            timezone={data.timezone}
            today={data.today}
          />
        )}
      </Stack>
      <AnalyticsOverview data={data} />
      <AnalyticsHighlights items={data.highlights} />
      <NutritionAnalytics block={data.nutrition} context={context} />
      <BodyAnalytics block={data.body} />
      <ActivityAnalytics block={data.activity} context={context} />
      <AnalyticsDataQuality data={data} />
    </Stack>
  );
}
