'use client';
import { PageHeader } from '@/components/layout/page-header';
import { offlineMessages } from '@/config/offline';
import { clientReads, seedClientRead } from '@/lib/client-read';
import { readResources } from '@/lib/read-descriptors';
import { sessionGeneration } from '@/lib/session-state';
import { useReadOnline } from '@/lib/use-read-online';
import { useReadResource } from '@/lib/use-read-resource';

import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import {
  medicalObservationCorrectionSchema,
  type MedicalObservation,
} from '@/contracts/anamnesis';
import { LineChart } from '@mantine/charts';
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { fetchAnamnesis, formatAnamnesisDate, ownerIdQuery } from './api';
import { MarkerAssessmentBadge } from './marker-table';
import { notifyAnamnesisChanged } from './refresh';

export function MarkerDetail({
  ownerId,
  markerId,
  writable,
}: {
  ownerId: string;
  markerId: string;
  writable: boolean;
}) {
  const online = useReadOnline();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<MedicalObservation>();
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const markerRead = useReadResource(
    readResources.marker(
      `/api/anamnesis/markers/${markerId}?${ownerIdQuery(ownerId)}`,
    ),
  );
  const observationsRead = useReadResource(
    readResources.observations(
      `/api/anamnesis/markers/${markerId}/observations?${ownerIdQuery(ownerId)}`,
    ),
  );
  const marker = markerRead.data;
  const items = observationsRead.data ?? [];
  const loading =
    observationsRead.data === undefined && !observationsRead.error;
  const loadError = markerRead.error || observationsRead.error;

  async function save() {
    if (!editing || !online) return;
    const parsed = medicalObservationCorrectionSchema.safeParse({
      expectedRevision: editing.revision,
      markerId,
      value: {
        kind: 'numeric',
        value: value.trim().replace(',', '.'),
        comparator: 'eq',
      },
      originalUnit: unit.trim() || null,
      collectedAt: date,
      datePrecision: 'date',
      referenceRange: editing.referenceRange,
    });
    if (!parsed.success) {
      setError(m.errors.save);
      return;
    }
    setBusy(true);
    setError(undefined);
    const expectedScope = sessionGeneration();
    try {
      const updated = await fetchAnamnesis<MedicalObservation>(
        `/api/anamnesis/observations/${editing.id}?${ownerIdQuery(ownerId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );
      const observations = items.map((item) =>
        item.id === updated.id ? updated : item,
      );
      const key = `/api/anamnesis/markers/${markerId}/observations?${ownerIdQuery(ownerId)}`;
      await clientReads.invalidate(key);
      await seedClientRead(key, observations, expectedScope);
      notifyAnamnesisChanged();

      setEditing(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error &&
          'status' in cause &&
          (cause as { status: number }).status === 409
          ? m.reviews.conflict
          : m.errors.save,
      );
    } finally {
      setBusy(false);
    }
  }

  const conflict =
    !!editing &&
    items.some(
      (item) => item.id === editing.id && item.revision !== editing.revision,
    );
  const numeric = items.filter((item) => item.value.kind === 'numeric');
  const chart = [...numeric]
    .filter((item) => item.collectedAt)
    .map((item) => ({
      date: item.collectedAt!,
      value: Number(item.value.value),
    }));
  const last = items[items.length - 1];
  const displayUnit = last?.normalizedUnit ?? last?.originalUnit ?? '';

  return (
    <Stack data-testid="anamnesis-marker-detail">
      <a href="/anamnesis#markers">
        {m.title} · {m.workspace.markers}
      </a>
      <PageHeader>{marker?.name ?? markerId}</PageHeader>
      {conflict && (
        <Alert color="orange">{offlineMessages.draftConflict}</Alert>
      )}
      {(error || loadError) && (
        <Alert color="red" role="alert">
          {error ?? m.errors.load}
        </Alert>
      )}
      {loading && <Text>{m.markers.noMarkerData}</Text>}
      {!loading && !items.length && <Text>{m.markers.empty}</Text>}
      {!!items.length && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Paper withBorder p="md">
              <Text size="sm" c="dimmed">
                {m.markers.column.last}
              </Text>
              <Text fs="1.6rem" fw={700}>
                {numeric.length
                  ? numeric[numeric.length - 1]!.value.value.replace('.', ',')
                  : items[items.length - 1]!.value.kind === 'text'
                    ? items[items.length - 1]!.value.value
                    : ''}{' '}
                {displayUnit}
              </Text>
              {last && last.referenceRange && (
                <ReferenceRangeBar observation={last} />
              )}
              {last && (
                <MarkerAssessmentBadge assessment={last.referenceAssessment} />
              )}
            </Paper>
          </SimpleGrid>
          {chart.length > 1 && (
            <>
              <Title order={2}>{m.markers.chart}</Title>
              <LineChart
                h={260}
                data={chart}
                dataKey="date"
                series={[
                  { name: 'value', label: marker?.name ?? '', color: 'teal.6' },
                ]}
                connectNulls={false}
              />
            </>
          )}
          <Title order={2}>{m.markers.history}</Title>
          <Table.ScrollContainer minWidth={640}>
            <Table data-testid="anamnesis-marker-history">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.markers.column.date}</Table.Th>
                  <Table.Th>{m.markers.column.last}</Table.Th>
                  <Table.Th>{m.markers.reference}</Table.Th>
                  <Table.Th>{m.markers.column.status}</Table.Th>
                  {writable && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((item) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>{formatAnamnesisDate(item.collectedAt)}</Table.Td>
                    <Table.Td>
                      {item.value.kind === 'numeric'
                        ? item.value.value.replace('.', ',')
                        : item.value.value}{' '}
                      {item.normalizedUnit ?? item.originalUnit ?? ''}
                    </Table.Td>
                    <Table.Td>
                      {item.referenceRange?.originalText ?? '—'}
                    </Table.Td>
                    <Table.Td>
                      <MarkerAssessmentBadge
                        assessment={item.referenceAssessment}
                      />
                      {item.verification === 'needs_review' && (
                        <Badge color="red" variant="light" ml="xs">
                          {m.verification.needs_review}
                        </Badge>
                      )}
                    </Table.Td>
                    {writable && (
                      <Table.Td>
                        <Button
                          variant="default"
                          mih={44}
                          disabled={busy || !online}
                          onClick={() => {
                            setEditing(item);
                            setValue(
                              item.value.kind === 'numeric'
                                ? item.value.value
                                : '',
                            );
                            setDate(item.collectedAt?.slice(0, 10) ?? '');
                            setUnit(item.originalUnit ?? '');
                          }}
                        >
                          Изменить
                        </Button>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {editing && (
            <Paper withBorder p="md">
              <Title order={3}>{m.reviews.editing}</Title>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <NumberInput
                  label={m.reviews.fields.value}
                  value={Number(value.replace(',', '.')) || undefined}
                  onChange={(next) => setValue(String(next ?? ''))}
                  decimalScale={6}
                  hideControls
                />
                <TextInput
                  type="date"
                  label={m.reviews.fields.date}
                  value={date}
                  onChange={(event) => setDate(event.currentTarget.value)}
                />
                <TextInput
                  label={m.reviews.fields.unit}
                  value={unit}
                  onChange={(event) => setUnit(event.currentTarget.value)}
                />
              </SimpleGrid>
              <Group mt="md">
                <Button
                  disabled={!online || conflict}
                  onClick={() => void save()}
                  loading={busy}
                  mih={44}
                >
                  {m.buttons.save}
                </Button>
                <Button
                  variant="default"
                  onClick={() => setEditing(undefined)}
                  mih={44}
                >
                  Отмена
                </Button>
              </Group>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

// Визуализация референсного интервала: полоса с маркером значения.
export function ReferenceRangeBar({
  observation,
}: {
  observation: MedicalObservation;
}) {
  const range = observation.referenceRange;
  if (!range || observation.value.kind !== 'numeric') return null;
  const numeric = Number(observation.value.value);
  const lower = range.lower === null ? null : Number(range.lower);
  const upper = range.upper === null ? null : Number(range.upper);
  if (lower === null && upper === null) return null;
  const low = lower ?? Math.min(numeric * 0.8, upper! * 0.5);
  const high = upper ?? Math.max(numeric * 1.2, lower! * 1.5);
  if (!(high > low)) return null;
  const clamp = (value: number) =>
    Math.max(2, Math.min(98, ((value - low) / (high - low)) * 100));
  return (
    <div
      style={{
        position: 'relative',
        height: 10,
        background: 'var(--mantine-color-gray-3)',
        borderRadius: 5,
        marginTop: 8,
        marginBottom: 4,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: `${clamp(lower ?? numeric)}%`,
          width: `${Math.max(0, clamp(upper ?? numeric) - clamp(lower ?? numeric))}%`,
          top: 0,
          bottom: 0,
          background: 'var(--mantine-color-teal-6)',
          opacity: 0.45,
          borderRadius: 5,
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: `${clamp(numeric)}%`,
          top: -3,
          width: 4,
          height: 16,
          background: 'var(--mantine-color-dark-6)',
          borderRadius: 2,
        }}
      />
    </div>
  );
}
