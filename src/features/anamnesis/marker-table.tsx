'use client';

import { useAnamnesisRevision } from './refresh';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { AnamnesisMarkerSummary } from '@/contracts/anamnesis';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { fetchAnamnesis, formatAnamnesisDate, ownerIdQuery } from './api';

export function MarkerTable({ ownerId }: { ownerId: string }) {
  const revision = useAnamnesisRevision();
  const [items, setItems] = useState<AnamnesisMarkerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [denied, setDenied] = useState(false);
  const [search, setSearch] = useState('');
  const url = `/api/anamnesis/markers?${ownerIdQuery(ownerId)}`;

  useEffect(() => {
    let active = true;
    fetchAnamnesis<AnamnesisMarkerSummary[]>(url)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof Error && 'status' in cause) {
          const status = (cause as { status: number }).status;
          if (status === 401 || status === 403) {
            setDenied(true);
            return;
          }
        }
        setError(m.errors.load);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, revision]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      item.marker.name.toLowerCase().includes(needle),
    );
  }, [items, search]);

  if (denied)
    return (
      <Stack data-testid="anamnesis-markers">
        <Title order={2}>{m.markers.title}</Title>
        <Alert color="red" role="alert">
          {m.errors.denied}
        </Alert>
      </Stack>
    );

  return (
    <Stack data-testid="anamnesis-markers">
      <Title order={2}>{m.markers.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <TextInput
        label={m.markers.search}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      {loading && <Text>{m.overview.empty}</Text>}
      {!loading && !items.length && <Text>{m.markers.empty}</Text>}
      {!!filtered.length && (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={640}>
            <Table data-testid="anamnesis-marker-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.markers.column.name}</Table.Th>
                  <Table.Th>{m.markers.column.last}</Table.Th>
                  <Table.Th>{m.markers.column.date}</Table.Th>
                  <Table.Th>{m.markers.column.count}</Table.Th>
                  <Table.Th>{m.markers.column.status}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((item) => (
                  <Table.Tr key={item.marker.id}>
                    <Table.Td>
                      <Link href={`/anamnesis/markers/${item.marker.id}`}>
                        {item.marker.name}
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      {item.lastValue === null ? (
                        <Text c="dimmed">{m.markers.noMarkerData}</Text>
                      ) : (
                        <Group gap="xs">
                          <span>{formatAnamnesisValueText(item)}</span>
                          {item.lastUnit && (
                            <Text size="sm" c="dimmed">
                              {item.lastUnit}
                            </Text>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {formatAnamnesisDate(item.lastCollectedAt)}
                    </Table.Td>
                    <Table.Td>{item.observationCount}</Table.Td>
                    <Table.Td>
                      {item.lastReferenceAssessment && (
                        <MarkerAssessmentBadge
                          assessment={item.lastReferenceAssessment}
                        />
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}

function formatAnamnesisValueText(item: AnamnesisMarkerSummary): string {
  return item.lastValue?.replace('.', ',') ?? '';
}

export function MarkerAssessmentBadge({
  assessment,
}: {
  assessment: 'below' | 'within' | 'above' | 'unknown';
}) {
  const color =
    assessment === 'above'
      ? 'orange'
      : assessment === 'below'
        ? 'indigo'
        : assessment === 'within'
          ? 'green'
          : 'gray';
  return (
    <Badge color={color} variant="light">
      {m.assessment[assessment]}
    </Badge>
  );
}
