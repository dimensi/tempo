'use client';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import {
  measurementMetrics,
  measurementInputSchema,
  type Measurement,
  type MeasurementMetric,
} from '@/contracts/measurements';
import { measurementMessages as m } from './messages';
import { measurementChange } from './history';
export function MeasurementsPanel({
  ownerId,
  writable,
}: {
  ownerId: string;
  writable: boolean;
}) {
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [values, setValues] = useState<
    Partial<Record<MeasurementMetric, string>>
  >({});
  const [metric, setMetric] = useState<MeasurementMetric>('weight');
  const url = `/api/measurements?ownerId=${encodeURIComponent(ownerId)}`;
  useEffect(() => {
    let active = true;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<Measurement[]>;
      })
      .then((data) => {
        if (active) setItems(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url]);
  function reset() {
    setEditing(undefined);
    setValues({});
    setNote('');
  }
  async function save() {
    const parsed = measurementInputSchema.safeParse({
      measuredAt: date,
      note: note || null,
      values: measurementMetrics
        .filter((key) => values[key]?.trim())
        .map((key) => ({
          metric: key,
          value: values[key]!.trim().replace(',', '.'),
          unit: key === 'weight' ? 'kg' : 'cm',
        })),
    });
    if (!parsed.success) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const r = await fetch(
        editing
          ? `/api/measurements/${editing}?ownerId=${encodeURIComponent(ownerId)}`
          : url,
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!r.ok) throw new Error();
      const item = (await r.json()) as Measurement;
      setItems((old) =>
        [...old.filter((x) => x.id !== item.id), item].sort((a, b) =>
          b.measuredAt.localeCompare(a.measuredAt),
        ),
      );
      reset();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/measurements/${id}?ownerId=${encodeURIComponent(ownerId)}`,
        { method: 'DELETE' },
      );
      if (!r.ok) throw new Error();
      setItems((old) => old.filter((x) => x.id !== id));
      setDeleting(undefined);
      if (editing === id) reset();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const chart = [...items].reverse().flatMap((item) => {
    const v = item.values.find((v) => v.metric === metric);
    return v ? [{ date: item.measuredAt, value: Number(v.value) }] : [];
  });
  return (
    <Stack>
      <Title order={1}>{m.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      {loading && <Text>{m.loading}</Text>}
      {writable && (
        <Paper withBorder p="md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Stack>
              <TextInput
                type="date"
                label={m.date}
                value={date}
                onChange={(e) => setDate(e.currentTarget.value)}
                required
              />
              <Text size="sm">{m.valueHint}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {measurementMetrics.map((key) => (
                  <TextInput
                    key={key}
                    label={`${m.metrics[key]} (${m.units[key === 'weight' ? 'kg' : 'cm']})`}
                    inputMode="decimal"
                    value={values[key] ?? ''}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setValues((old) => ({ ...old, [key]: value }));
                    }}
                  />
                ))}
              </SimpleGrid>
              <Textarea
                label={m.note}
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
              <Group>
                <Button type="submit" loading={busy} mih={44}>
                  {m.save}
                </Button>
                {editing && (
                  <Button
                    variant="default"
                    onClick={reset}
                    disabled={busy}
                    mih={44}
                  >
                    {m.cancel}
                  </Button>
                )}
              </Group>
            </Stack>
          </form>
        </Paper>
      )}
      <Title order={2}>{m.trend}</Title>
      <Select
        label={m.trend}
        data={measurementMetrics.map((value) => ({
          value,
          label: m.metrics[value],
        }))}
        value={metric}
        onChange={(v) => {
          if (v) setMetric(v as MeasurementMetric);
        }}
      />
      {chart.length ? (
        <LineChart
          h={260}
          data={chart}
          dataKey="date"
          series={[
            { name: 'value', label: m.metrics[metric], color: 'blue.6' },
          ]}
        />
      ) : (
        <Text>{m.empty}</Text>
      )}
      <Title order={2}>{m.history}</Title>
      {!loading && !items.length && <Text>{m.empty}</Text>}
      <Table.ScrollContainer minWidth={580}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{m.date}</Table.Th>
              <Table.Th>{m.title}</Table.Th>
              <Table.Th>{m.note}</Table.Th>
              {writable && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>{item.measuredAt}</Table.Td>
                <Table.Td>
                  {item.values.map((v) => (
                    <Text key={v.metric} size="sm">
                      {m.metrics[v.metric]}: {v.value} {m.units[v.unit]}{' '}
                      {measurementChange(items, item, v.metric) !== null &&
                        `(${measurementChange(items, item, v.metric)})`}
                    </Text>
                  ))}
                </Table.Td>
                <Table.Td style={{ overflowWrap: 'anywhere', maxWidth: 240 }}>
                  {item.note}
                </Table.Td>
                {writable && (
                  <Table.Td>
                    <Group>
                      <Button
                        variant="default"
                        mih={44}
                        disabled={busy}
                        onClick={() => {
                          setEditing(item.id);
                          setDate(item.measuredAt);
                          setNote(item.note ?? '');
                          setValues(
                            Object.fromEntries(
                              item.values.map((v) => [v.metric, v.value]),
                            ),
                          );
                        }}
                      >
                        {m.edit}
                      </Button>
                      <Button
                        color="red"
                        mih={44}
                        disabled={busy}
                        onClick={() =>
                          deleting === item.id
                            ? void remove(item.id)
                            : setDeleting(item.id)
                        }
                      >
                        {deleting === item.id ? m.confirm : m.remove}
                      </Button>
                      {deleting === item.id && (
                        <Button
                          variant="default"
                          onClick={() => setDeleting(undefined)}
                        >
                          {m.cancel}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
