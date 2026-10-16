import { HealthOverviewSteps } from '@/features/health';
import { Overview } from '@/features/overview';
import { Stack } from '@mantine/core';
export const metadata = { title: 'Обзор' };
export default function Page() {
  return (
    <Stack gap={32}>
      <Overview />
      <HealthOverviewSteps />
    </Stack>
  );
}
