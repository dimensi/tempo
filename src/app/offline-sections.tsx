'use client';
import { useSyncExternalStore } from 'react';
import { Alert, Button, Stack, Text, TextInput, Title } from '@mantine/core';
import { stepsGoalMessages } from '@/contracts/steps-goal';
import type { OfflineSnapshot } from '@/contracts/offline';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { Overview } from '@/features/overview/read';
import {
  AnalyticsDashboard,
  PeriodControlView,
  presetRange,
} from '@/features/analytics/read';
import { MeasurementsPanel } from '@/features/measurements';
import { WeightHistoryPanel, StepsPanel } from '@/features/health';
import { ReportForm } from '@/features/reports';
import { CommentReadContent } from '@/features/comments';
import { OfflineFile } from '@/components/shared/offline-file';
import {
  offlineMessages as m,
  offlineNavigate,
  OfflineSettings,
} from '@/features/offline';
import { CatalogReadContent } from '@/features/workouts/read';
import {
  savedOverview,
  savedAnalytics,
  savedWeight,
  savedDiaryDay,
  savedMeasurements,
} from './offline-model';
import { summarizeSteps } from '@/lib/steps-summary';
import { getOfflineController } from '@/lib/offline-controller';

export function OfflineComments({
  snapshot,
  target,
}: {
  snapshot: OfflineSnapshot;
  target: string;
}) {
  const rows = snapshot.views.comments.filter((row) => row.target === target);
  return (
    <Stack>
      <Title order={2} size="h3">
        {m.cachedComments}
      </Title>
      {!snapshot.views.commentsComplete && <Text c="dimmed">{m.partial}</Text>}
      {!rows.length && (
        <Text c="dimmed">
          {snapshot.views.commentsComplete ? m.noComments : m.unknown}
        </Text>
      )}
      {rows.map((row) => (
        <CommentReadContent
          key={row.key}
          authorName={row.authorName}
          body={row.body}
          parentAuthor={
            snapshot.views.comments.find(
              (parent) => parent.key === row.parentKey,
            )?.authorName
          }
        />
      ))}
    </Stack>
  );
}
export function OfflineVideos({
  snapshot,
  href,
}: {
  snapshot: OfflineSnapshot;
  href: string;
}) {
  return snapshot.views.videos
    .filter((video) => video.sessionHref === href)
    .map((video) => (
      <OfflineFile
        key={video.id}
        id={`video:${video.id}`}
        label={m.workouts}
        kind="video"
        size={video.size}
        offline
      />
    ));
}
export function OfflineSection({
  snapshot,
  url,
  today,
}: {
  snapshot?: OfflineSnapshot;
  url: URL;
  today: string;
}) {
  const unknown = <Alert role="status">{m.unknown}</Alert>;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const summary = snapshot?.views.summary;
  const coverage = summary && (
    <Text size="sm" c="dimmed">
      {m.coverage}: {summary.from} — {summary.to}. {m.partial}
    </Text>
  );
  if (url.pathname === '/workouts/catalog')
    return (
      <CatalogReadContent
        items={snapshot?.views.catalog ?? []}
        complete={snapshot?.views.catalogComplete ?? false}
      />
    );
  if (url.pathname === '/') {
    const data = snapshot && savedOverview(snapshot, today, timezone);
    return (
      <Stack>
        {data ? (
          <Overview
            saved={data}
            plannedUnknown={!!summary && summary.to < today}
          />
        ) : (
          unknown
        )}
        {coverage}
        {summary && (
          <StepsPanel
            summary={summarizeSteps(presetRange('week', today), summary.steps)}
          />
        )}
      </Stack>
    );
  }
  if (url.pathname === '/analytics') {
    const range = analyticsRangeSchema.safeParse(
      url.searchParams.has('from') || url.searchParams.has('to')
        ? { from: url.searchParams.get('from'), to: url.searchParams.get('to') }
        : presetRange('week', today),
    );
    const data =
      snapshot &&
      range.success &&
      savedAnalytics(snapshot, range.data, today, timezone);
    return (
      <Stack>
        {coverage}
        {data ? (
          <AnalyticsDashboard
            key={`${data.range.from}:${data.range.to}:${snapshot?.serverNow}`}
            data={data}
            navigationSlot={
              <PeriodControlView
                range={data.range}
                previous={data.previousRange}
                today={today}
                timezone={timezone}
                onNavigate={(range) =>
                  offlineNavigate(
                    `/analytics?${new URLSearchParams({ ...range, timezone })}`,
                  )
                }
              />
            }
          />
        ) : (
          unknown
        )}
        {!range.success && (
          <Button component="a" href="/analytics" mih={44}>
            {m.retryConnection}
          </Button>
        )}
      </Stack>
    );
  }
  if (url.pathname === '/measurements')
    return (
      <Stack>
        {snapshot ? (
          <>
            <Text size="sm" c="dimmed">
              {m.coverage}: {snapshot.from} — {snapshot.to}. {m.partial}
            </Text>
            <MeasurementsPanel
              key={snapshot.serverNow}
              ownerId={snapshot.partition}
              writable={false}
              saved={savedMeasurements(snapshot)}
              weightHistory={savedWeight(snapshot, {
                from: snapshot.from,
                to: snapshot.to,
              })}
              renderComments={(id) => (
                <OfflineComments
                  snapshot={snapshot}
                  target={`measurement:${id}`}
                />
              )}
            />
            {summary && <WeightHistoryPanel history={summary.weight} />}
          </>
        ) : (
          <>
            <Title order={1}>{m.measurements}</Title>
            {unknown}
          </>
        )}
      </Stack>
    );
  if (url.pathname === '/settings') {
    const settings = snapshot?.views.settings;
    return (
      <Stack>
        <Title order={1}>{m.settings}</Title>
        {settings ? (
          <>
            <TextInput
              label="YAZIO"
              value={settings.yazioConnected ? m.connected : m.disconnected}
              disabled
            />
            <TextInput
              label="TransformMate"
              value={
                settings.transformMateConnected ? m.connected : m.disconnected
              }
              disabled
            />
            <TextInput
              label={m.initialFrom}
              value={settings.initialFrom ?? m.noData}
              disabled
            />
            <TextInput
              label={stepsGoalMessages.title}
              value={
                snapshot?.views.summary?.dailyStepsGoal?.toString() ??
                stepsGoalMessages.disabled
              }
              disabled
            />
            <TextInput label={m.timezone} value={settings.timezone} disabled />
            <TextInput
              label={m.automaticSync}
              value={settings.automaticSync ? m.yes : m.no}
              disabled
            />
            <Text>
              {m.saved}:{' '}
              {settings.lastSuccess
                ? new Date(settings.lastSuccess).toLocaleString('ru-RU')
                : m.noData}
            </Text>
          </>
        ) : (
          unknown
        )}
        <Text c="dimmed">{m.readonly}</Text>
        <OfflineSettings />
        <OfflineFiles />
      </Stack>
    );
  }
  if (url.pathname === '/reports')
    return (
      <Stack>
        {snapshot ? (
          <OfflineReport snapshot={snapshot} />
        ) : (
          <>
            <Title order={1}>{m.sectionTitle('/reports')}</Title>
            {unknown}
          </>
        )}
        <OfflineFiles kind="pdf" />
      </Stack>
    );
  return (
    <Stack>
      <Title order={1}>{m.sectionTitle(url.pathname)}</Title>
      {unknown}
    </Stack>
  );
}

export function OfflineFiles({ kind }: { kind?: 'pdf' | 'video' }) {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const files = state.files.filter((file) => !kind || file.kind === kind);
  return (
    <Stack>
      <Title order={2} size="h3">
        {m.files}
      </Title>
      {!files.length && <Text>{m.unknown}</Text>}
      {files.map((file) => (
        <OfflineFile
          key={file.id}
          id={file.id}
          label={file.label}
          kind={file.kind}
          offline
        />
      ))}
    </Stack>
  );
}

function OfflineReport({ snapshot }: { snapshot: OfflineSnapshot }) {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return (
    <ReportForm
      ownerId={snapshot.partition}
      offlineDays={snapshot.diary.flatMap((day) => {
        const saved = savedDiaryDay(snapshot, day.date);
        return saved ? [saved] : [];
      })}
      offlineSteps={snapshot.dailySteps}
      offlineStepsGoal={snapshot.views.summary?.dailyStepsGoal ?? null}
      offlinePhotos={snapshot.photos.items.map((photo) => ({
        id: photo.id,
        date: photo.date,
        daytime: photo.daytime,
        source: photo.source,
        observedAt: photo.observedAt,
        bytes: state.photos.find((copy) => copy.id === photo.id)?.bytes ?? null,
      }))}
    />
  );
}
