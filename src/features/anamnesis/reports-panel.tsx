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
  SimpleGrid,
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
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
          const available = markerList.filter(
            (item) => item.observationCount > 0,
          );
          setMarkers(available);
          setSelected(new Set(available.map((item) => item.marker.id)));
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
      from: from || null,
      to: to || null,
    });
    if (!parsed.success) {
      setError(
        selected.size
          ? m.reports.builder.invalidPeriod
          : m.reports.builder.selectAtLeast,
      );
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
      setNotice(created.id);
      try {
        const list = await fetchAnamnesis<MedicalReportExport[]>(
          `/api/anamnesis/reports?${query}`,
        );
        setItems(list);
      } catch {
        setError(m.errors.load);
      }
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
        <Stack gap="md">
          <div>
            <Title order={2}>{m.reports.builder.title}</Title>
            <Text size="sm" c="dimmed">
              {m.reports.builder.description}
            </Text>
          </div>
          {loading ? (
            <Text role="status">{m.reports.loading}</Text>
          ) : !markers.length ? (
            !error && <Text>{m.reports.builder.noMeasurements}</Text>
          ) : (
            <>
              <Group justify="space-between">
                <Checkbox
                  label={m.reports.builder.selectAll}
                  checked={selected.size === markers.length}
                  indeterminate={
                    selected.size > 0 && selected.size < markers.length
                  }
                  disabled={busy}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelected(
                      new Set(
                        checked ? markers.map((item) => item.marker.id) : [],
                      ),
                    );
                  }}
                  styles={{ body: { minHeight: 44, alignItems: 'center' } }}
                />
                <Button
                  variant="subtle"
                  disabled={busy || !selected.size}
                  onClick={() => setSelected(new Set())}
                  mih={44}
                >
                  {m.reports.builder.clearSelection}
                </Button>
              </Group>
              <Stack
                gap={0}
                role="group"
                aria-label={m.reports.builder.markers}
              >
                {markers.map((item) => (
                  <Checkbox
                    key={item.marker.id}
                    label={`${item.marker.name} (${item.observationCount})`}
                    checked={selected.has(item.marker.id)}
                    disabled={busy}
                    styles={{ body: { minHeight: 44, alignItems: 'center' } }}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelected((old) => {
                        const next = new Set(old);
                        if (checked) next.add(item.marker.id);
                        else next.delete(item.marker.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </Stack>
              <Text size="sm" role="status">
                {m.reports.builder.selected}: {selected.size} / {markers.length}
              </Text>
              <div>
                <Group justify="space-between" mb="xs">
                  <Text fw={500}>{m.reports.builder.period}</Text>
                  {(from || to) && (
                    <Button
                      variant="subtle"
                      disabled={busy}
                      mih={44}
                      onClick={() => {
                        setFrom('');
                        setTo('');
                      }}
                    >
                      {m.wholePeriod}
                    </Button>
                  )}
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    type="date"
                    label={m.reports.builder.from}
                    value={from}
                    max={to || undefined}
                    disabled={busy}
                    onChange={(event) => setFrom(event.currentTarget.value)}
                    styles={{ input: { minHeight: 44 } }}
                  />
                  <TextInput
                    type="date"
                    label={m.reports.builder.to}
                    value={to}
                    min={from || undefined}
                    disabled={busy}
                    onChange={(event) => setTo(event.currentTarget.value)}
                    styles={{ input: { minHeight: 44 } }}
                  />
                </SimpleGrid>
                <Text size="sm" c="dimmed" mt="xs">
                  {m.reports.builder.wholeHistoryHint}
                </Text>
              </div>
              <Button
                onClick={() => void generate()}
                loading={busy}
                disabled={!selected.size}
                mih={44}
              >
                {m.reports.builder.generate}
              </Button>
            </>
          )}
          {notice && (
            <Alert color="green" title={m.reports.ready}>
              <Button
                component="a"
                href={`/api/anamnesis/reports/${notice}/file?${query}`}
                target="_blank"
                rel="noreferrer"
                variant="default"
                mih={44}
              >
                {m.reports.download}
              </Button>
            </Alert>
          )}
        </Stack>
      </Paper>
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
                        {m.reports.ready}
                      </Text>
                    ) : null}
                    <Button
                      component="a"
                      href={`/api/anamnesis/reports/${item.id}/file?${query}`}
                      target="_blank"
                      rel="noreferrer"
                      variant="default"
                      mih={44}
                    >
                      {m.reports.download}
                    </Button>
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
