import { headers } from 'next/headers';
import { Alert, Stack, Title } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { getAnalytics, AnalyticsError } from '@/server/analytics';
import { getStepsSummary, HealthReadError } from '@/server/health';
import { StepsPanel } from '@/features/health';
import {
  AnalyticsDashboard,
  analyticsMessages as m,
  presetRange,
} from '@/features/analytics';
export const metadata = { title: m.title };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <Alert color="orange">{m.forbidden}</Alert>;
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const range =
    params.from !== undefined || params.to !== undefined
      ? { from: params.from, to: params.to }
      : presetRange('week', today);
  let data;
  let steps;
  try {
    data = await getAnalytics(requestHeaders, ownerId, range);
    steps = await getStepsSummary(requestHeaders, range);
  } catch (error) {
    const message =
      (error instanceof AnalyticsError || error instanceof HealthReadError) &&
      error.status === 400
        ? m.rangeError
        : (error instanceof AnalyticsError ||
              error instanceof HealthReadError) &&
            error.status === 403
          ? m.forbidden
          : m.loadError;
    return (
      <Stack>
        <Title order={1}>{m.title}</Title>
        <Alert color="red">{message}</Alert>
        <a href="/analytics">{m.retry}</a>
      </Stack>
    );
  }
  return (
    <Stack gap="lg" style={{ minWidth: 0 }}>
      <AnalyticsDashboard
        key={`${data.summary.range.from}:${data.summary.range.to}`}
        {...data}
        today={today}
      />
      <StepsPanel summary={steps} />
    </Stack>
  );
}
