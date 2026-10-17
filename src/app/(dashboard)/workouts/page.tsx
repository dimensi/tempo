'use client';
import { CommentsPanel } from '@/features/comments';
import { OfflineWrites } from '@/features/offline';
import { WorkoutsDashboard } from '@/features/workouts';
import { useReadContext } from '@/lib/client-session';
import { Stack } from '@mantine/core';
export default function Page() {
  const context = useReadContext();
  return (
    <Stack>
      <WorkoutsDashboard
        userId={context.readerId}
        ownerId={context.ownerId}
        canLog={context.role === 'OWNER'}
        renderPendingWrites={
          context.role === 'OWNER'
            ? () => <OfflineWrites kind="workout" pendingOnly />
            : undefined
        }
        renderComments={(id) => (
          <CommentsPanel
            ownerId={context.ownerId}
            target={{ type: 'workout', id }}
          />
        )}
      />
    </Stack>
  );
}
