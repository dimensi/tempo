import { headers } from 'next/headers';
import { Alert, Stack, Title } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { getAnalytics, AnalyticsError } from '@/server/analytics';
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
  try {
    data = await getAnalytics(requestHeaders, ownerId, range);
  } catch (error) {
    const message =
      error instanceof AnalyticsError && error.status === 400
        ? m.rangeError
        : error instanceof AnalyticsError && error.status === 403
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
    <AnalyticsDashboard
      key={`${data.summary.range.from}:${data.summary.range.to}`}
      {...data}
      today={today}
    />
  );
}
