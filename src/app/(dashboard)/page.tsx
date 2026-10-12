import { requireSession } from '@/server/auth/guards';
import { Overview } from '@/features/overview';
import { Stack } from '@mantine/core';
import { HealthOverviewSteps } from '@/features/health';
export const metadata = { title: 'Обзор' };
export default async function Page() {
  await requireSession();
  return (
    <Stack gap={32} maw={1000} style={{ minWidth: 0 }}>
      <Overview />
      <HealthOverviewSteps />
    </Stack>
  );
}
