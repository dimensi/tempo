import { headers } from 'next/headers';
import { Alert } from '@mantine/core';
import { requireSession, authorize } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { CatalogPage, workoutMessages } from '@/features/workouts';
export default async function Page() {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (
    !ownerId ||
    !(await authorize(requestHeaders, 'workouts:read', ownerId)).ok
  )
    return <Alert>{workoutMessages.noAccess}</Alert>;
  return <CatalogPage ownerId={ownerId} />;
}
