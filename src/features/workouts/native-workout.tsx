'use client';

import {
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { TransformMateNativeItem } from '@/contracts/transformmate-native';
import { useState } from 'react';
import { IconInfoCircle } from '@tabler/icons-react';
import { ExerciseDetails } from './exercise-details';
import { workoutMessages as m } from './messages';

type NativeSet =
  TransformMateNativeItem['exercises'][number]['metrics'][number]['sets'][number];
function SetMetrics({ sets }: { sets: NativeSet[] }) {
  if (!sets.length) return <Text size="sm">—</Text>;
  return (
    <Stack gap={4}>
      {sets.map((set, index) => (
        <Stack gap={2} key={index}>
          {set.done !== null && (
            <Text size="sm" fw={600}>
              {set.done ? m.done : m.notDone}
            </Text>
          )}
          {set.metrics.map((metric, metricIndex) => (
            <Text size="sm" key={`${metric.key}-${metricIndex}`}>
              {metric.name}:{' '}
              {metric.values.length ? metric.values.join(' / ') : '—'}
              {metric.unit ? ` ${metric.unit}` : ''}
            </Text>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

export function NativeWorkout({
  item,
  ownerId,
  fullView = false,
}: {
  item: TransformMateNativeItem;
  ownerId?: string;
  fullView?: boolean;
}) {
  const [inspecting, setInspecting] = useState<string | null>(null);
  return (
    <Paper
      withBorder={!fullView}
      p={fullView ? 0 : 'md'}
      data-testid={`native-workout-${item.remoteTrainingId}`}
      style={{ overflowWrap: 'anywhere' }}
    >
      <Stack gap="md">
        <Group justify="space-between">
          {!fullView && <Title order={2}>{item.title || m.workoutTitle}</Title>}
          <Badge variant="outline" color="gray">
            {m.sync}
          </Badge>
        </Group>
        <Text size="sm">{m.nativeReadonly}</Text>
        {item.progress && (
          <Text size="sm">
            {m.status}: {item.progress}
          </Text>
        )}
        {item.started && (
          <Text size="sm">
            {m.remoteStartedAt}:{' '}
            {new Date(item.started).toLocaleString('ru-RU')}
          </Text>
        )}
        {item.finished && (
          <Text size="sm">
            {m.remoteFinishedAt}:{' '}
            {new Date(item.finished).toLocaleString('ru-RU')}
          </Text>
        )}
        {[...item.exercises]
          .sort(
            (a, b) => a.protocolOrder - b.protocolOrder || a.order - b.order,
          )
          .map((exercise) => {
            const planned = exercise.metrics
              .filter((metric) => metric.type === 'plan')
              .flatMap((metric) => metric.sets);
            const actual = exercise.metrics
              .filter((metric) => metric.type === 'fact')
              .flatMap((metric) => metric.sets);
            const orders = [
              ...new Set([...planned, ...actual].map((set) => set.order)),
            ].sort((a, b) => a - b);
            return (
              <Stack
                gap="xs"
                key={`${exercise.protocolId}-${exercise.remoteExerciseId}`}
              >
                <Group justify="space-between" gap="xs">
                  <Title order={3}>{exercise.name || m.exercise}</Title>
                  {ownerId &&
                    inspecting !==
                      `${exercise.protocolId}-${exercise.remoteExerciseId}` && (
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        mih={44}
                        leftSection={<IconInfoCircle size={16} />}
                        aria-label={`${m.details}: ${exercise.name}`}
                        onClick={() =>
                          setInspecting(
                            `${exercise.protocolId}-${exercise.remoteExerciseId}`,
                          )
                        }
                      >
                        {m.details}
                      </Button>
                    )}
                </Group>
                {ownerId &&
                  inspecting ===
                    `${exercise.protocolId}-${exercise.remoteExerciseId}` && (
                    <ExerciseDetails
                      key={`${ownerId}-${exercise.exerciseId}`}
                      ownerId={ownerId}
                      exerciseId={exercise.exerciseId}
                    />
                  )}
                {exercise.comment && (
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {exercise.comment}
                  </Text>
                )}
                <ScrollArea type="auto">
                  <Table miw={280} style={{ tableLayout: 'fixed' }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={80}>{m.set}</Table.Th>
                        <Table.Th>{m.planned}</Table.Th>
                        <Table.Th>{m.actual}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {orders.map((order) => (
                        <Table.Tr key={order}>
                          <Table.Td>{order}</Table.Td>
                          <Table.Td>
                            <SetMetrics
                              sets={planned.filter(
                                (set) => set.order === order,
                              )}
                            />
                          </Table.Td>
                          <Table.Td>
                            <SetMetrics
                              sets={actual.filter((set) => set.order === order)}
                            />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                {!orders.length && <Text size="sm">{m.nativeEmptySets}</Text>}
              </Stack>
            );
          })}
        <Text size="xs">
          {m.nativeFetched}: {new Date(item.fetchedAt).toLocaleString('ru-RU')}
        </Text>
      </Stack>
    </Paper>
  );
}
