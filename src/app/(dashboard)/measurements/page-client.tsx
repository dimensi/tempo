'use client';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { ResourcePending } from '@/components/shared/read-resource-pending';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { CommentsPanel } from '@/features/comments';
import { WeightHistoryPanel } from '@/features/health';
import { MeasurementsPanel } from '@/features/measurements';
import { OfflineWrites } from '@/features/offline';
import { useReadContext } from '@/lib/client-session';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Stack } from '@mantine/core';
export function MeasurementsPage() {
  const context = useReadContext();
  const today = browserToday();
  const weight = useReadResource(
    readResources.weight(
      `/api/health/weight?from=${shiftDate(today, -365)}&to=${today}`,
    ),
  );
  if (!weight.data) return <ResourcePending {...weight} />;
  return (
    <Stack>
      {context.role === 'OWNER' && <OfflineWrites kind="measurement" />}
      <MeasurementsPanel
        ownerId={context.ownerId}
        writable={context.role === 'OWNER'}
        deviceWrites={context.role === 'OWNER'}
        weightHistory={weight.data}
        renderComments={(id) => (
          <CommentsPanel
            ownerId={context.ownerId}
            target={{ type: 'measurement', id }}
          />
        )}
      />
      <WeightHistoryPanel history={weight.data} />
    </Stack>
  );
}
