'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  TextInput,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  medicalReportRequestSchema,
  type AnamnesisMarkerSummary,
  type MedicalReportExport,
} from '@/contracts/anamnesis';
import { anamnesisMessages as m } from './messages';
import { fetchAnamnesis, ownerIdQuery } from './api';

export function ReportsPanel({ ownerId }: { ownerId: string }) {
  const [items, setItems] = useState<MedicalReportExport[]>([]);
  const [markers, setMarkers] = useState<AnamnesisMarkerSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const query = ownerIdQuery(ownerId);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [reports, markerList] = await Promise.all([
          fetchAnamnesis<MedicalReportExport[]>(
            `/api/anamnesis/reports?${query}`,
          ),
          fetchAnamnesis<AnamnesisMarkerSummary[]>(
            `/api/anamnesis/markers?${query}`,
          ),
        ]);
        if (active) {
          setItems(reports);
          setMarkers(markerList);
        }
      } catch {
        if (active) setError(m.errors.load);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [query]);

  async function generate() {
    const parsed = medicalReportRequestSchema.safeParse({
      markerIds: [...selected],
      from: from ? from.toISOString().slice(0, 10) : null,
      to: to ? to.toISOString().slice(0, 10) : null,
    });
    if (!parsed.success) {
      setError(m.reports.builder.selectAtLeast);
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const created = await fetchAnamnesis<{ id: string }>(
        `/api/anamnesis/reports?${query}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );
      const list = await fetchAnamnesis<MedicalReportExport[]>(
        `/api/anamnesis/reports?${query}`,
      );
      setItems(list);
      setNotice(created.id);
    } catch (cause) {
      if (
        cause instanceof Error &&
        'status' in cause &&
        (cause as { status: number }).status === 404
      ) {
        setError(m.errors.noData);
      } else {
        setError(m.errors.save);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack data-testid="anamnesis-reports">
      <Title order={1}>{m.reports.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Paper withBorder p="md">
        <Title order={2}>{m.reports.builder.title}</Title>
        <Text size="sm" c="dimmed" mb="sm">
          {m.reports.builder.markers}
        </Text>
        <Stack gap="xs">
          {markers.map((item) => (
            <Checkbox
              key={item.marker.id}
              label={`${item.marker.name} (${item.observationCount})`}
              checked={selected.has(item.marker.id)}
              onChange={(event) => {
                setSelected((old) => {
                  const next = new Set(old);
                  if (event.currentTarget.checked) next.add(item.marker.id);
                  else next.delete(item.marker.id);
                  return next;
                });
              }}
            />
          ))}
        </Stack>
        <Group mt="md" align="flex-end">
          <TextInput
            type="date"
            label={m.reports.builder.from}
            value={from ? from.toISOString().slice(0, 10) : ''}
            onChange={(event) =>
              setFrom(
                event.currentTarget.value
                  ? new Date(event.currentTarget.value)
                  : null,
              )
            }
          />
          <TextInput
            type="date"
            label={m.reports.builder.to}
            value={to ? to.toISOString().slice(0, 10) : ''}
            onChange={(event) =>
              setTo(
                event.currentTarget.value
                  ? new Date(event.currentTarget.value)
                  : null,
              )
            }
          />
          <Button onClick={() => void generate()} loading={busy} mih={44}>
            {m.reports.builder.generate}
          </Button>
        </Group>
      </Paper>
      {loading && <Text>…</Text>}
      {!loading && !items.length && <Text>{m.reports.empty}</Text>}
      {!!items.length && (
        <Table.ScrollContainer minWidth={640}>
          <Table data-testid="anamnesis-report-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{m.reports.column.filename}</Table.Th>
                <Table.Th>{m.reports.column.markers}</Table.Th>
                <Table.Th>{m.reports.column.size}</Table.Th>
                <Table.Th>{m.reports.column.created}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>{item.filename}</Table.Td>
                  <Table.Td>{item.markerIds.length}</Table.Td>
                  <Table.Td>{Math.round(item.sizeBytes / 1024)} КБ</Table.Td>
                  <Table.Td>
                    {new Date(item.createdAt).toLocaleString('ru-RU')}
                  </Table.Td>
                  <Table.Td>
                    {notice === item.id ? (
                      <Text size="sm" c="green">
                        Готов
                      </Text>
                    ) : null}
                    <a
                      href={`/api/anamnesis/reports/${item.id}/file?${query}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button variant="default" mih={44}>
                        {m.reports.download}
                      </Button>
                    </a>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
