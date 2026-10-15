'use client';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Anchor,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { OfflineViews } from '@/contracts/offline-views';
import { OfflineFile } from '@/components/shared/offline-file';
import { offlineMessages as m } from '@/config/offline';
export function CatalogReadContent({
  items,
  complete,
  renderDetails,
  partialLabel = m.partial,
}: {
  items: OfflineViews['catalog'];
  complete: boolean;
  renderDetails?: (id: number) => ReactNode;
  partialLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const catalog = items;
  const rows = catalog.filter((row) =>
    `${row.name} ${row.muscleGroups.join(' ')}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>{m.cachedCatalog}</Title>
        <Anchor href="/workouts">{m.workouts}</Anchor>
      </Group>
      <TextInput
        label={m.findExercise}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {!complete && <Text c="dimmed">{partialLabel}</Text>}
      {!rows.length && <Alert>{m.unknown}</Alert>}
      {rows.map((row) => (
        <Stack key={row.id} gap="xs">
          <Title order={2} size="h3">
            {row.name}
          </Title>
          <Text size="sm" c="dimmed">
            {row.muscleGroups.join(' · ')}
          </Text>
          <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {row.description ?? m.unknown}
          </Text>
          <Text size="xs" c="dimmed">
            {m.saved}: {new Date(row.fetchedAt).toLocaleString('ru-RU')}
          </Text>
          {renderDetails?.(row.id)}
          {row.hasVideo && (
            <OfflineFile
              id={`exercise-video:${row.id}`}
              kind="video"
              label={row.name}
              offline
            />
          )}
        </Stack>
      ))}
    </Stack>
  );
}
