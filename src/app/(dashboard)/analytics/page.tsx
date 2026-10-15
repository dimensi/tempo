import { LiveAnalytics } from '@/app/live-analytics';
import { headers } from 'next/headers';
import { Alert, Stack, Title } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { getAnalytics, AnalyticsError } from '@/server/analytics';
import {
  analyticsMessages as m,
  AnalyticsTimezone,
  PeriodControl,
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
  if (params.timezone === undefined)
    return <AnalyticsTimezone from={params.from} to={params.to} />;
  let data;
  try {
    data = await getAnalytics(
      requestHeaders,
      ownerId,
      { from: params.from, to: params.to },
      params.timezone,
    );
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
    <LiveAnalytics
      key={`${data.range.from}:${data.range.to}:${data.timezone}`}
      initial={data}
      navigationSlot={
        <PeriodControl
          range={data.range}
          previous={data.previousRange}
          timezone={data.timezone}
          today={data.today}
        />
      }
    />
  );
}
