'use client';
import type { ReadSettings } from '@/contracts/read-settings';
import { useReportReadModel } from './snapshot-reads';
import { SettingsReadView } from './(dashboard)/settings/read-view';
import { OfflineWrites } from '@/features/offline';
import { Stack, Skeleton, Button, Title, Text } from '@mantine/core';
import { z } from 'zod';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { DiaryClient } from '@/features/nutrition';
import {
  nutritionDaySchema,
  safeMealPhotoViewSchema,
} from '@/contracts/nutrition';
import {
  WorkoutsDashboard,
  WorkoutDetailView,
  CatalogPage,
} from '@/features/workouts/read';
import { MeasurementsPanel } from '@/features/measurements';
import { CommentsPanel } from '@/features/comments';
import { Overview } from '@/features/overview';
import { HealthOverviewSteps, WeightHistoryPanel } from '@/features/health';
import { weightHistorySchema } from '@/contracts/health';
import {
  AnalyticsDashboard,
  AnalyticsTimezone,
  PeriodControl,
  presetRange,
} from '@/features/analytics';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { analyticsDataSchema } from '@/contracts/read-analytics';
import {
  AnamnesisWorkspace,
  MarkerDetail,
  DocumentViewer,
} from '@/features/anamnesis';
import { anamnesisOverviewSchema } from '@/contracts/anamnesis';
import { ReportForm } from '@/features/reports';
import { useReadResource } from '@/lib/use-read-resource';
import type { ReadContext } from '@/contracts/read-context';
import { workoutDetailSchema } from '@/contracts/read-workout';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { readWorkspaceMessages as m } from '@/config/read-workspace';

const pending = <Skeleton height={180} />;
function Diary({ context, date }: { context: ReadContext; date: string }) {
  const query = new URLSearchParams({
    ownerId: context.ownerId,
    from: date,
    to: date,
  });
  const day = useReadResource({
    href: `/api/nutrition/days?${query}`,
    parse: (value) => z.array(nutritionDaySchema).parse(value),
  });
  const photos = useReadResource({
    href: `/api/nutrition/photos?${query}`,
    parse: (value) => z.array(safeMealPhotoViewSchema).parse(value),
  });
  return (
    <DiaryClient
      loading={day.data === undefined && day.refreshing}
      privatePhotos
      ownerId={context.ownerId}
      date={date}
      day={day.data?.[0] ?? null}
      photos={photos.data ?? []}
      canWrite={context.role === 'OWNER'}
      commentsSlot={
        day.data?.[0] ? (
          <CommentsPanel
            ownerId={context.ownerId}
            target={{ type: 'nutrition_day', id: date }}
          />
        ) : undefined
      }
    />
  );
}
function Measurements({
  context,
  today,
}: {
  context: ReadContext;
  today: string;
}) {
  const weight = useReadResource({
    href: `/api/health/weight?from=${shiftDate(today, -365)}&to=${today}`,
    parse: (value) => weightHistorySchema.parse(value),
  });
  if (!weight.data) return pending;
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
function Analytics({ url, today }: { url: URL; today: string }) {
  const timezone =
    url.searchParams.get('timezone') ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const range = analyticsRangeSchema.safeParse(
    url.searchParams.has('from') || url.searchParams.has('to')
      ? { from: url.searchParams.get('from'), to: url.searchParams.get('to') }
      : presetRange('week', today),
  );
  const resource = useReadResource({
    href: range.success
      ? `/api/read/analytics?${new URLSearchParams({ ...range.data, timezone })}`
      : undefined,
    parse: (value) => analyticsDataSchema.parse(value),
  });
  if (!url.searchParams.has('timezone'))
    return (
      <AnalyticsTimezone
        from={url.searchParams.get('from') ?? undefined}
        to={url.searchParams.get('to') ?? undefined}
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
    pending
  );
}
function Detail({
  url,
  context,
  date,
}: {
  url: URL;
  context: ReadContext;
  date: string;
}) {
  const resource = useReadResource({
    href: `/api/read/workout?${new URLSearchParams({ path: url.pathname, date })}`,
    parse: (value) => workoutDetailSchema.parse(value),
  });
  return resource.data ? (
    <WorkoutDetailView
      ownerId={context.ownerId}
      canLog={context.role === 'OWNER'}
      date={date}
      detail={resource.data}
      renderComments={(id) => (
        <CommentsPanel
          ownerId={context.ownerId}
          target={{ type: 'workout', id }}
        />
      )}
    />
  ) : resource.error ? (
    <Text>{m.notFound}</Text>
  ) : (
    pending
  );
}
function Anamnesis({ url, context }: { url: URL; context: ReadContext }) {
  const overview = useReadResource({
    href: `/api/anamnesis/overview?ownerId=${encodeURIComponent(context.ownerId)}`,
    parse: (value) => anamnesisOverviewSchema.parse(value),
  });
  const marker = url.pathname.match(/^\/anamnesis\/markers\/([^/]+)$/);
  const document = url.pathname.match(/^\/anamnesis\/documents\/([^/]+)$/);
  if (marker)
    return (
      <MarkerDetail
        ownerId={context.ownerId}
        markerId={decodeURIComponent(marker[1]!)}
        writable={context.role === 'OWNER'}
      />
    );
  if (document)
    return (
      <DocumentViewer
        ownerId={context.ownerId}
        documentId={decodeURIComponent(document[1]!)}
        writable={context.role === 'OWNER'}
      />
    );
  return overview.data ? (
    <AnamnesisWorkspace
      ownerId={context.ownerId}
      writable={context.role === 'OWNER'}
      initial={overview.data}
    />
  ) : (
    pending
  );
}
function Reports({ context }: { context: ReadContext }) {
  const model = useReportReadModel();
  return <ReportForm ownerId={context.ownerId} {...model} />;
}
/** The only route-to-feature composition, used by the server entry and the cached public shell. */
export function ReadWorkspaceRoute({
  href,
  context,
  initialSettings,
}: {
  href: string;
  context: ReadContext;
  initialSettings?: ReadSettings;
}) {
  const url = new URL(href, 'https://tempo.local');
  const today = browserToday();
  const selected = z.iso.date().safeParse(url.searchParams.get('date'));
  const date = selected.success ? selected.data : today;
  if (url.pathname === '/')
    return (
      <Stack gap={32}>
        <Overview />
        <HealthOverviewSteps />
      </Stack>
    );
  if (url.pathname === '/diary') return <Diary context={context} date={date} />;
  if (url.pathname === '/workouts')
    return (
      <Stack>
        {context.role === 'OWNER' && <OfflineWrites kind="workout" />}
        <Button
          component="a"
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
  if (url.pathname === '/workouts/catalog')
    return <CatalogPage ownerId={context.ownerId} />;
  if (url.pathname.startsWith('/workouts/'))
    return <Detail url={url} context={context} date={date} />;
  if (url.pathname === '/measurements')
    return <Measurements context={context} today={today} />;
  if (url.pathname === '/analytics')
    return <Analytics url={url} today={today} />;
  if (url.pathname === '/settings')
    return (
      <SettingsReadView
        initial={initialSettings}
        ownerId={context.ownerId}
        owner={context.role === 'OWNER'}
      />
    );
  if (url.pathname === '/reports') return <Reports context={context} />;
  if (url.pathname.startsWith('/anamnesis'))
    return <Anamnesis url={url} context={context} />;
  return <Title order={1}>{m.notFound}</Title>;
}
