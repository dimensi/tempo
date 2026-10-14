import { Stack } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { AnamnesisNavigation } from '@/features/anamnesis';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return (
    <Stack gap="lg">
      <AnamnesisNavigation owner={session.user.role === 'OWNER'} />
      {children}
    </Stack>
  );
}
