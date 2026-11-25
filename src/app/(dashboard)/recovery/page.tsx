import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Alert, Stack } from '@mantine/core';
import { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import {
  dateInTimezone,
  shiftDate,
  timezoneSchema,
} from '@/contracts/nutrition-sync-dates';
import {
  RecoveryBrowserTimezone,
  RecoveryDashboard,
  RecoveryRangeControls,
  recoveryMessages as m,
} from '@/features/recovery';
import { requireSession } from '@/server/auth/guards';
import { getRecovery, RecoveryReadError } from '@/server/recovery';

export const metadata = { title: m.title };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (session.user.role !== 'OWNER') notFound();

  const params = await searchParams;
  const days = params.days === '7' ? 7 : 14;
  const zone = timezoneSchema.safeParse(params.timezone);
  const timezone = zone.data ?? 'UTC';
  const today = dateInTimezone(new Date(), timezone);
  const parsedTo = z.iso.date().safeParse(params.to);
  const explicitTo =
    parsedTo.success && parsedTo.data >= '1901-01-15' && parsedTo.data < today
      ? parsedTo.data
      : undefined;
  const to = explicitTo ?? today;
  const range = { from: shiftDate(to, 1 - days), to, timezone };

  let history;
  let error;
  try {
    history = await getRecovery(await headers(), session.user.id, range);
  } catch (cause) {
    if (
      cause instanceof RecoveryReadError &&
      (cause.status === 401 || cause.status === 403)
    )
      notFound();
    if (!(cause instanceof RecoveryReadError)) throw cause;
    error = cause.status === 422 ? m.sleepLimit : m.loadError;
  }

  return (
    <Stack gap="lg">
      <PageHeader>{m.title}</PageHeader>
      {!zone.success && <RecoveryBrowserTimezone days={days} to={explicitTo} />}
      {history ? (
        <RecoveryDashboard history={history} today={today} days={days} />
      ) : (
        <>
          <RecoveryRangeControls {...range} today={today} days={days} />
          <Alert color="red" role="alert">
            {error}
          </Alert>
        </>
      )}
    </Stack>
  );
}
