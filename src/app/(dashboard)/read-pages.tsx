'use client';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { readWorkspaceMessages as m } from '@/config/read-workspace';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import {
  AnalyticsDashboard,
  AnalyticsTimezone,
  PeriodControl,
  presetRange,
} from '@/features/analytics';
import {
  AnamnesisWorkspace,
  DocumentViewer,
  MarkerDetail,
} from '@/features/anamnesis';
import { CommentsPanel } from '@/features/comments';
import { HealthOverviewSteps, WeightHistoryPanel } from '@/features/health';
import { MeasurementsPanel } from '@/features/measurements';
import { DiaryClient } from '@/features/nutrition';
import { OfflineWrites } from '@/features/offline';
import { Overview } from '@/features/overview';
import { ReportForm } from '@/features/reports';
import {
  CatalogPage,
  WorkoutDetailView,
  WorkoutsDashboard,
} from '@/features/workouts';
import { useReadContext } from '@/lib/client-session';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import type { readWorkoutDetails } from '@/server/workouts/details';
import { Button, Skeleton, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { SettingsReadView } from './settings/read-view';
function ResourcePending({
  error,
  refresh,
}: {
  error?: string;
  refresh: () => Promise<void>;
}) {
  return error ? (
    <Stack>
      <Text>{m.actionUnavailable}</Text>
      <Button onClick={() => void refresh()}>{m.retry}</Button>
    </Stack>
  ) : (
    <Skeleton height={180} />
  );
}
function useSelectedDate() {
  const params = useSearchParams();
  const selected = z.iso.date().safeParse(params.get('date'));
  return selected.success ? selected.data : browserToday();
}
export function OverviewPage() {
  return (
    <Stack gap={32}>
      <Overview />
      <HealthOverviewSteps />
    </Stack>
  );
}
export function DiaryPage() {
  const context = useReadContext();
  const date = useSelectedDate();
  const query = new URLSearchParams({
    ownerId: context.ownerId,
    from: date,
    to: date,
  });
  const day = useReadResource(
    readResources.diary(`/api/nutrition/days?${query}`),
  );
  const photos = useReadResource(
    readResources.photos(`/api/nutrition/photos?${query}`),
  );
  if (!day.data) return <ResourcePending {...day} />;
  return (
    <DiaryClient
      ownerId={context.ownerId}
      date={date}
      day={day.data[0] ?? null}
      photos={photos.data ?? []}
      canWrite={context.role === 'OWNER'}
      loading={false}
      commentsSlot={
        day.data[0] ? (
          <CommentsPanel
            ownerId={context.ownerId}
            target={{ type: 'nutrition_day', id: date }}
          />
        ) : undefined
      }
    />
  );
}
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
export function WorkoutDetailPage({
  resource,
}: {
  resource: Parameters<typeof readWorkoutDetails>[2];
}) {
  const context = useReadContext();
  const date = useSelectedDate();
  const query = new URLSearchParams({ kind: resource.kind, date });
  if (resource.kind === 'plan') {
    query.set('planId', resource.planId);
    query.set('workoutId', resource.workoutId);
  } else query.set('id', String(resource.id));
  const read = useReadResource(
    readResources.workout(`/api/read/workout?${query}`),
  );
  return read.data ? (
    <WorkoutDetailView
      ownerId={context.ownerId}
      canLog={context.role === 'OWNER'}
      date={date}
      detail={read.data}
      renderComments={(id) => (
        <CommentsPanel
          ownerId={context.ownerId}
          target={{ type: 'workout', id }}
        />
      )}
    />
  ) : (
    <ResourcePending {...read} />
  );
}
export function CatalogReadPage() {
  const context = useReadContext();
  return <CatalogPage ownerId={context.ownerId} />;
}
export function AnalyticsPage() {
  const params = useSearchParams();
  const today = browserToday();
  const timezone =
    params.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const range = analyticsRangeSchema.safeParse(
    params.has('from') || params.has('to')
      ? { from: params.get('from'), to: params.get('to') }
      : presetRange('week', today),
  );
  const resource = useReadResource(
    readResources.analytics(
      range.success
        ? `/api/read/analytics?${new URLSearchParams({ ...range.data, timezone })}`
        : undefined,
    ),
  );
  if (!params.has('timezone'))
    return (
      <AnalyticsTimezone
        from={params.get('from') ?? undefined}
        to={params.get('to') ?? undefined}
      />
    );
  if (!range.success) return <Text>{m.invalidRange}</Text>;
  return resource.data ? (
    <AnalyticsDashboard
      data={resource.data}
      navigationSlot={
        <PeriodControl
          range={resource.data.range}
          previous={resource.data.previousRange}
          today={today}
          timezone={timezone}
        />
      }
    />
  ) : (
    <ResourcePending {...resource} />
  );
}
export function AnamnesisPage() {
  const context = useReadContext();
  const read = useReadResource(
    readResources.anamnesis(
      `/api/anamnesis/overview?ownerId=${encodeURIComponent(context.ownerId)}`,
    ),
  );
  return read.data ? (
    <AnamnesisWorkspace
      ownerId={context.ownerId}
      writable={context.role === 'OWNER'}
      initial={read.data}
    />
  ) : (
    <ResourcePending {...read} />
  );
}
export function MarkerPage({ markerId }: { markerId: string }) {
  const context = useReadContext();
  return (
    <MarkerDetail
      ownerId={context.ownerId}
      markerId={markerId}
      writable={context.role === 'OWNER'}
    />
  );
}
export function DocumentPage({ documentId }: { documentId: string }) {
  const context = useReadContext();
  return (
    <DocumentViewer
      ownerId={context.ownerId}
      documentId={documentId}
      writable={context.role === 'OWNER'}
    />
  );
}
export function ReportsPage() {
  const context = useReadContext();
  return <ReportForm ownerId={context.ownerId} />;
}
export function SettingsPage() {
  const context = useReadContext();
  return (
    <SettingsReadView
      ownerId={context.ownerId}
      owner={context.role === 'OWNER'}
    />
  );
}
