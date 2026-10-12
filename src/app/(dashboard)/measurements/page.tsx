import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { MeasurementsWithComments } from './with-comments';
import { measurementMessages as m } from '@/features/measurements';
import { Alert, Stack } from '@mantine/core';
import { WeightHistoryPanel, healthMessages } from '@/features/health';
import { getWeightHistory, HealthReadError } from '@/server/health';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
export const metadata = { title: m.title };
export default async function Page() {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <p>{m.denied}</p>;
  const access = await authorize(requestHeaders, 'measurements:read', ownerId);
  if (!access.ok) return <p>{m.denied}</p>;
  const writeAccess = await authorize(
    requestHeaders,
    'measurements:write',
    ownerId,
  );
  const today = new Date().toISOString().slice(0, 10);
  let history;
  try {
    history = await getWeightHistory(requestHeaders, {
      from: shiftDate(today, -365),
      to: today,
    });
  } catch (error) {
    return (
      <Alert color="red">
        {error instanceof HealthReadError && error.status === 403
          ? healthMessages.forbidden
          : healthMessages.unavailable}
      </Alert>
    );
  }
  return (
    <Stack gap="lg" style={{ minWidth: 0 }}>
      <MeasurementsWithComments ownerId={ownerId} writable={writeAccess.ok} />
      <WeightHistoryPanel history={history} />
    </Stack>
  );
}
