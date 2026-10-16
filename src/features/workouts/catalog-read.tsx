'use client';
import { offlineMessages as m } from '@/config/offline';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import Link from 'next/link';
import { type ReactNode } from 'react';
export function CatalogReadContent({
  items,
  complete,
  renderDetails,
  partialLabel = m.partial,
}: {
  items: {
    id: number;
    name: string;
    description: string | null;
    muscleGroups: string[];
    fetchedAt: string | null;
    hasVideo: boolean;
  }[];
  complete: boolean;
  renderDetails?: (id: number) => ReactNode;
  partialLabel?: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get('query') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('query', value);
    else next.delete('query');
    router.replace(`/workouts/catalog?${next}`, { scroll: false });
  };
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
        <Anchor component={Link} href="/workouts">
          {m.workouts}
        </Anchor>
      </Group>
      <TextInput
        label={m.findExercise}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {!complete && <Text c="dimmed">{partialLabel}</Text>}
      {!rows.length && <Alert>{m.noMatches}</Alert>}
      {rows.map((row) => (
        <Stack key={row.id} gap="xs">
          <Title order={2} size="h3">
            {row.name}
          </Title>
          <Text size="sm" c="dimmed">
            {row.muscleGroups.join(' · ')}
          </Text>
          <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {row.description ?? m.noDescription}
          </Text>
          {renderDetails?.(row.id)}
        </Stack>
      ))}
    </Stack>
  );
}
