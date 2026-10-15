import { Alert, Button, Stack, Title } from '@mantine/core';
import { workoutMessages as m } from '@/features/workouts';
import { WorkoutsWithComments } from './with-comments';
import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
export const metadata = { title: m.title };
export default async function Page() {
  const session = await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  const permission = ownerId
    ? await authorize(requestHeaders, 'workouts:read', ownerId)
    : null;
  const access =
    ownerId && permission?.ok
      ? { ownerId, canLog: session.user.role === 'OWNER' }
      : null;
  return access ? (
    <Stack>
      <Button component="a" href="/workouts/catalog" variant="subtle" mih={44}>
        {m.exerciseCatalog}
      </Button>
      <WorkoutsWithComments {...access} />
    </Stack>
  ) : (
    <Stack>
      <Title order={1}>{m.title}</Title>
      <Alert>{m.noAccess}</Alert>
    </Stack>
  );
}
