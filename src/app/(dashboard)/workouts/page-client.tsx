'use client';
import { readWorkspaceMessages as m } from '@/config/read-workspace';
import { CommentsPanel } from '@/features/comments';
import { OfflineWrites } from '@/features/offline';
import { WorkoutsDashboard } from '@/features/workouts';
import { useReadContext } from '@/lib/client-session';
import { Button, Stack } from '@mantine/core';
import Link from 'next/link';
export function WorkoutsPage() {
  const context = useReadContext();
  return (
    <Stack>
      {context.role === 'OWNER' && <OfflineWrites kind="workout" />}
      <Button
        component={Link}
        href="/workouts/catalog"
        variant="subtle"
        mih={44}
      >
        {m.catalog}
      </Button>
      <WorkoutsDashboard
        ownerId={context.ownerId}
        canLog={context.role === 'OWNER'}
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
