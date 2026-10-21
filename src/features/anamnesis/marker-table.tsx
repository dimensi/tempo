'use client';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';

import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import type { AnamnesisMarkerSummary } from '@/contracts/anamnesis';
import {
  Alert,
  Badge,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import Link from 'next/link';
import { useState } from 'react';
import { formatAnamnesisDate, ownerIdQuery } from './api';
import classes from './marker-table.module.css';

export function MarkerTable({ ownerId }: { ownerId: string }) {
  const [search, setSearch] = useState('');
  const url = `/api/anamnesis/markers?${ownerIdQuery(ownerId)}`;
  const resource = useReadResource(readResources.markers(url));
  const items = resource.data ?? [];
  const loading = resource.data === undefined && !resource.error;
  const error = resource.error;

  const needle = search.trim().toLowerCase();
  const filtered = items.filter((item) =>
    item.marker.name.toLowerCase().includes(needle),
  );

  return (
    <Stack data-testid="anamnesis-markers">
      <Title order={2}>{m.markers.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {m.errors.load}
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
        <Paper withBorder className={classes.container}>
          <ul className={classes.list} aria-label={m.markers.title}>
            {filtered.map((item) => (
              <li key={item.marker.id} className={classes.row}>
                <div className={classes.primary}>
                  <Link
                    href={`/anamnesis/markers/${item.marker.id}`}
                    className={classes.name}
                  >
                    {item.marker.name}
                  </Link>
                  <div className={classes.result}>
                    {item.lastValue === null ? (
                      <Text size="sm">{m.markers.noMarkerData}</Text>
                    ) : (
                      <>
                        <Text fw={600} className={classes.value}>
                          {formatAnamnesisValueText(item)}
                        </Text>
                        {item.lastUnit && (
                          <Text size="sm" className={classes.unit}>
                            {item.lastUnit}
                          </Text>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className={classes.meta}>
                  <Text size="sm">
                    {formatAnamnesisDate(item.lastCollectedAt)}
                  </Text>
                  <Text size="sm">
                    {m.markers.column.count}: {item.observationCount}
                  </Text>
                  {item.lastReferenceAssessment && (
                    <MarkerAssessmentBadge
                      assessment={item.lastReferenceAssessment}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
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
