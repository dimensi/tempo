import { Alert, Stack, Title } from '@mantine/core';
import { WorkoutsDashboard, workoutMessages as m } from '@/features/workouts';
import { workoutsPageAccess } from '@/server/workouts/page';
export const metadata = { title: m.title };
export default async function Page() {
  const access = await workoutsPageAccess();
  return access ? (
    <WorkoutsDashboard {...access} />
  ) : (
    <Stack>
      <Title order={1}>{m.title}</Title>
      <Alert>{m.noAccess}</Alert>
    </Stack>
  );
}
