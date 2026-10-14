import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { anamnesisMessages as m } from '@/features/anamnesis';
import { getAnamnesisOverview } from '@/server/anamnesis';
import { AnamnesisOverviewCards } from '@/features/anamnesis';
import Link from 'next/link';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';

export const metadata = { title: m.title };

export default async function Page() {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <p>{m.errors.denied}</p>;
  const access = await authorize(requestHeaders, 'anamnesis:read', ownerId);
  if (!access.ok) return <p>{m.errors.denied}</p>;
  let overview: Awaited<ReturnType<typeof getAnamnesisOverview>> | null = null;
  let loadFailed = false;
  try {
    overview = await getAnamnesisOverview(requestHeaders, ownerId);
  } catch {
    loadFailed = true;
  }
  if (loadFailed)
    return (
      <Alert color="red" role="alert">
        {m.errors.load}
      </Alert>
    );
  if (!overview) return null;
  return (
    <Stack gap="lg" data-testid="anamnesis-page">
      {access.session.user.role === 'OWNER' && (
        <Group>
          <Button component={Link} href="/anamnesis/documents" mih={44}>
            {m.documents.upload}
          </Button>
        </Group>
      )}
      <AnamnesisOverviewCards overview={overview} />
      {!overview.documents && !overview.observations ? (
        <Text>{m.overview.empty}</Text>
      ) : null}
      {overview.pendingReviews > 0 && (
        <Alert color="orange" role="status">
          <Link href="/anamnesis/reviews">{m.overview.goToReviews}</Link>
        </Alert>
      )}
    </Stack>
  );
}
