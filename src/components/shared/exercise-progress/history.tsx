'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Accordion,
  Button,
  Drawer,
  Group,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import type { ProgressOccurrence } from '@/contracts/exercise-progress';
import { progressRange, repeatExerciseSets } from '@/lib/exercise-progress';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { useReadOnline } from '@/lib/use-read-online';
import { ProgressChart } from './chart';
import { progressMessages as m } from './messages';
import {
  dateLabel,
  setsLabel,
  metricLabel,
  originalMetricLabel,
} from './format';
import styles from './progress.module.css';

export function ProgressReadState({
  read,
}: {
  read: ReturnType<typeof useReadResource>;
}) {
  const online = useReadOnline();
  if (read.data)
    return read.error ? (
      <Text size="sm" c="var(--progress-muted)" role="status">
        {m.stale}
      </Text>
    ) : null;
  return read.error || !online ? (
    <Stack gap={4}>
      <Text size="sm" c="var(--progress-muted)">
        {online ? m.unavailable : m.notLoaded}
      </Text>
      <Button
        variant="subtle"
        w="fit-content"
        onClick={() => void read.refresh()}
      >
        {m.retry}
      </Button>
    </Stack>
  ) : (
    <Skeleton height={50} />
  );
}
function RecordDetails({
  row,
  onRepeat,
  compact = false,
}: {
  row: ProgressOccurrence;
  onRepeat?: (row: ProgressOccurrence) => void;
  compact?: boolean;
}) {
  const repeatable =
    row.status === 'completed' &&
    repeatExerciseSets({ sets: [] }, row) !== null;
  return (
    <Stack gap="xs" className={styles.numbers}>
      <Text size="sm" c="var(--progress-muted)">
        {m.source[row.source]}
        {row.status !== 'completed' && ` · ${m.status[row.status]}`}
      </Text>
      {compact ? (
        <Text size="sm">{setsLabel(row)}</Text>
      ) : (
        <Stack gap={4}>
          {row.sets.map((set) => (
            <Stack gap={4} key={set.order}>
              <Text size="sm">
                {set.order}.{' '}
                {set.value
                  ? setsLabel({ ...row, sets: [set] })
                  : set.metrics.map(metricLabel).join('; ') || '—'}
              </Text>
            </Stack>
          ))}
        </Stack>
      )}
      {row.comment && (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {row.comment}
        </Text>
      )}
      {(row.fatigue !== null || row.failure !== null) && (
        <Text size="sm">
          {[
            row.fatigue !== null ? `${m.fatigue}: ${row.fatigue}/10` : null,
            row.failure !== null
              ? `${m.failure}: ${m.failures[row.failure]}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
      <Group className={styles.actions}>
        {onRepeat && repeatable && (
          <Button variant="light" mih={44} onClick={() => onRepeat(row)}>
            {m.repeat}
          </Button>
        )}
        <Button
          component={Link}
          href={row.href}
          variant="transparent"
          className={styles.action}
        >
          {m.openWorkout}
        </Button>
      </Group>
      {row.sets.some((set) => set.metrics.length > 0) && (
        <details className={styles.disclosure}>
          <summary>{m.original}</summary>
          <Stack gap={4}>
            {row.sets.map((set) => (
              <Text key={set.order} size="sm" c="var(--progress-muted)">
                {set.order}. {set.metrics.map(originalMetricLabel).join('; ')}
              </Text>
            ))}
            {row.possibleOverlap && (
              <Text size="sm" c="var(--progress-muted)">
                {m.overlap}
              </Text>
            )}
          </Stack>
        </details>
      )}
    </Stack>
  );
}
function Records({
  rows,
  onRepeat,
}: {
  rows: ProgressOccurrence[];
  onRepeat?: (row: ProgressOccurrence) => void;
}) {
  return (
    <Accordion>
      {rows.map((row) => (
        <Accordion.Item key={row.key} value={row.key}>
          <Accordion.Control
            aria-label={`${dateLabel(row.date)} · ${m.source[row.source]} · ${setsLabel(row)}`}
          >
            <Text fw={600} size="sm">
              {dateLabel(row.date)} · {m.source[row.source]}
            </Text>
            <Text size="sm" className={styles.numbers} lineClamp={2}>
              {setsLabel(row)}
            </Text>
            {row.status !== 'completed' && (
              <Text size="sm" c="var(--progress-muted)">
                {m.status[row.status]}
              </Text>
            )}
          </Accordion.Control>
          <Accordion.Panel>
            <RecordDetails row={row} onRepeat={onRepeat} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
function MoreRecords({
  href,
  onRepeat,
}: {
  href: string;
  onRepeat?: (row: ProgressOccurrence) => void;
}) {
  const read = useReadResource(readResources.exerciseHistory(href));
  const [next, setNext] = useState(false);
  const nextHref = read.data?.nextCursor
    ? (() => {
        const url = new URL(href, 'https://tempo.local');
        url.searchParams.set('cursor', read.data.nextCursor);
        return url.pathname + url.search;
      })()
    : undefined;
  return (
    <Stack gap="xs">
      <ProgressReadState read={read} />
      {read.data && <Records rows={read.data.records} onRepeat={onRepeat} />}
      {nextHref &&
        (next ? (
          <MoreRecords href={nextHref} onRepeat={onRepeat} />
        ) : (
          <Button variant="default" onClick={() => setNext(true)}>
            {m.more}
          </Button>
        ))}
    </Stack>
  );
}
function HistoryBody({
  ownerId,
  exerciseId,
  anchorDate,
  onRepeat,
}: {
  ownerId: string;
  exerciseId: number;
  anchorDate: string;
  onRepeat?: (row: ProgressOccurrence) => void;
}) {
  const [days, setDays] = useState('90');
  const range = progressRange(anchorDate, Number(days));
  const query = new URLSearchParams({
    ownerId,
    exerciseId: String(exerciseId),
    ...range,
  });

  const href = `/api/read/exercise-progress/history?${query}`;
  const read = useReadResource(readResources.exerciseHistory(href));
  const data = read.data;
  const [moreFor, setMoreFor] = useState('');
  return (
    <Stack gap="xl">
      <SegmentedControl
        fullWidth
        aria-label={m.period}
        value={days}
        onChange={setDays}
        data={[
          { value: '30', label: m.month },
          { value: '90', label: m.quarter },
          { value: '366', label: m.year },
        ]}
      />
      <ProgressReadState read={read} />
      {data && (
        <>
          {!data.records.length ? (
            <Text>{m.empty}</Text>
          ) : (
            <>
              <Stack gap="md">
                {(['LOCAL', 'TransformMate'] as const)
                  .filter((source) =>
                    data.latest.some((row) => row.source === source),
                  )
                  .map((source) => (
                    <Stack gap="sm" key={source}>
                      {data.latest
                        .filter((row) => row.source === source)
                        .map((row, index) => (
                          <div className={styles.record} key={row.key}>
                            <Text fw={600} mb={6}>
                              {index ? m.previousExecution : m.previous} ·{' '}
                              {dateLabel(row.date)}
                            </Text>
                            <RecordDetails
                              row={row}
                              onRepeat={onRepeat}
                              compact
                            />
                          </div>
                        ))}
                    </Stack>
                  ))}
              </Stack>
              <div className={styles.section}>
                <ProgressChart key={href} points={data.points} />
              </div>
              <Stack gap="xs" className={styles.section}>
                <Title order={3} size="h5">
                  {m.dates}
                </Title>
                <Records rows={data.records} onRepeat={onRepeat} />
                {data.nextCursor &&
                  (moreFor === href ? (
                    <MoreRecords
                      key={href}
                      href={`${href}&cursor=${encodeURIComponent(data.nextCursor)}`}
                      onRepeat={onRepeat}
                    />
                  ) : (
                    <Button variant="default" onClick={() => setMoreFor(href)}>
                      {m.more}
                    </Button>
                  ))}
              </Stack>
            </>
          )}
          <details className={styles.disclosure}>
            <summary>{m.about}</summary>
            <Text size="sm" c="var(--progress-muted)">
              {m.sourcesHint} {m.savedHint}
            </Text>
          </details>
        </>
      )}
    </Stack>
  );
}
export function ExerciseHistory({
  ownerId,
  exerciseId,
  name,
  anchorDate,
  onClose,
  onRepeat,
}: {
  ownerId: string;
  exerciseId: number;
  name: string;
  anchorDate: string;
  onClose: () => void;
  onRepeat?: (row: ProgressOccurrence) => void;
}) {
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const reduced = useReducedMotion();
  return (
    <Drawer
      opened
      onClose={onClose}
      title={
        <Stack gap={2}>
          <Text fw={700}>{name}</Text>
          <Text size="sm" c="var(--progress-muted)">
            {m.history}
          </Text>
        </Stack>
      }
      position="right"
      size={mobile ? '100%' : 600}
      closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      transitionProps={{ duration: reduced ? 0 : 180 }}
      classNames={{ header: styles.drawerHeader, body: styles.drawerBody }}
    >
      <HistoryBody
        ownerId={ownerId}
        exerciseId={exerciseId}
        anchorDate={anchorDate}
        onRepeat={onRepeat}
      />
    </Drawer>
  );
}
