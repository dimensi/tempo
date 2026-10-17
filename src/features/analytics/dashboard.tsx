'use client';
import { PageHeader } from '@/components/layout/page-header';
import type { ReactNode } from 'react';
import { Stack, Text } from '@mantine/core';
import type { AnalyticsData } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
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
  navigationSlot: ReactNode;
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
          <PageHeader>{m.title}</PageHeader>
          <Text c="dimmed">{m.description}</Text>
        </div>
        {navigationSlot}
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
