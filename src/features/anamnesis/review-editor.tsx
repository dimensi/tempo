'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  medicalObservationCorrectionSchema,
  type MedicalObservation,
  type MedicalObservationSource,
  type MedicalReviewItem,
} from '@/contracts/anamnesis';
import { anamnesisMessages as m } from './messages';
import { MarkerAssessmentBadge } from './marker-table';
import {
  fetchAnamnesis,
  formatAnamnesisDate,
  formatAnamnesisValue,
  ownerIdQuery,
} from './api';

interface ReviewEntry {
  review: MedicalReviewItem;
  observation: MedicalObservation;
  sources: MedicalObservationSource[];
}

export function ReviewEditor({ ownerId }: { ownerId: string }) {
  const [items, setItems] = useState<ReviewEntry[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const query = ownerIdQuery(ownerId);
  const url = `/api/anamnesis/reviews?${query}`;

  useEffect(() => {
    let active = true;
    fetchAnamnesis<ReviewEntry[]>(url)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch(() => {
        if (active) setError(m.errors.load);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url]);

  function startEditing(entry: ReviewEntry) {
    setEditing(entry.review.id);
    setValue(
      entry.observation.value.kind === 'numeric'
        ? entry.observation.value.value.replace('.', ',')
        : entry.observation.value.value,
    );
    setDate(entry.observation.collectedAt?.slice(0, 10) ?? '');
  }

  async function confirm(entry: ReviewEntry) {
    // Подтверждение без даты невозможно по контракту: открываем правку.
    if (editing !== entry.review.id && entry.observation.collectedAt === null) {
      startEditing(entry);
      setError(m.reviews.fields.date + ': ' + m.reviews.editing.toLowerCase());
      return;
    }
    const correction = medicalObservationCorrectionSchema.safeParse({
      expectedRevision: entry.observation.revision,
      markerId: entry.observation.markerId,
      value:
        editing === entry.review.id
          ? parseValueInput(value, entry.observation)
          : entry.observation.value,
      originalUnit: entry.observation.originalUnit,
      collectedAt:
        editing === entry.review.id ? date : entry.observation.collectedAt,
      datePrecision:
        editing === entry.review.id ? 'date' : entry.observation.datePrecision,
      referenceRange: entry.observation.referenceRange,
    });
    if (!correction.success) {
      setError(m.errors.save);
      return;
    }
    setBusy(entry.review.id);
    setError(undefined);
    try {
      await fetchAnamnesis(
        `/api/anamnesis/reviews/${entry.review.id}/confirm?${query}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(correction.data),
        },
      );
      setItems((old) =>
        old.filter((item) => item.review.id !== entry.review.id),
      );
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
      setBusy(undefined);
    }
  }

  async function reject(entry: ReviewEntry) {
    setBusy(entry.review.id);
    setError(undefined);
    try {
      await fetchAnamnesis(
        `/api/anamnesis/reviews/${entry.review.id}/reject?${query}`,
        {
          method: 'POST',
        },
      );
      setItems((old) =>
        old.filter((item) => item.review.id !== entry.review.id),
      );
    } catch {
      setError(m.errors.save);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Stack data-testid="anamnesis-reviews">
      <Title order={1}>{m.reviews.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {loading && <Text>…</Text>}
      {!loading && !items.length && <Text>{m.reviews.empty}</Text>}
      {items.map((entry) => (
        <Paper
          key={entry.review.id}
          withBorder
          p="md"
          data-testid="anamnesis-review-item"
        >
          <Stack>
            <Group>
              <Text fw={600}>{entry.observation.originalName}</Text>
              <Badge color="red" variant="light">
                {m.reviewReason[entry.review.reason]}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Text>
                {m.reviews.fields.value}:{' '}
                {formatAnamnesisValue(entry.observation.value)}{' '}
                {entry.observation.originalUnit ?? ''}
              </Text>
              <Text>
                {m.reviews.fields.date}:{' '}
                {formatAnamnesisDate(entry.observation.collectedAt)}
              </Text>
              {entry.observation.referenceRange && (
                <Text>
                  {m.reviews.fields.reference}:{' '}
                  {entry.observation.referenceRange.originalText}
                </Text>
              )}
            </SimpleGrid>
            {entry.sources.map((source) => (
              <Text key={source.id} size="sm" c="dimmed">
                {m.documents.sourceQuote}: стр. {source.pageNumber} — «
                {source.rawText}»
              </Text>
            ))}
            <MarkerAssessmentBadge
              assessment={entry.observation.referenceAssessment}
            />
            {editing === entry.review.id && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label={m.reviews.fields.value}
                  value={value}
                  onChange={(event) => setValue(event.currentTarget.value)}
                />
                <TextInput
                  type="date"
                  label={m.reviews.fields.date}
                  value={date}
                  onChange={(event) => setDate(event.currentTarget.value)}
                />
              </SimpleGrid>
            )}
            <Group>
              <Button
                mih={44}
                loading={busy === entry.review.id}
                onClick={() => void confirm(entry)}
              >
                {m.reviews.confirm}
              </Button>
              <Button
                variant="light"
                color="red"
                mih={44}
                loading={busy === entry.review.id}
                onClick={() => void reject(entry)}
              >
                {m.reviews.reject}
              </Button>
              <Button
                variant="default"
                mih={44}
                onClick={() => {
                  if (editing === entry.review.id) {
                    setEditing(undefined);
                    return;
                  }
                  setEditing(entry.review.id);
                  setValue(
                    entry.observation.value.kind === 'numeric'
                      ? entry.observation.value.value.replace('.', ',')
                      : entry.observation.value.value,
                  );
                  setDate(entry.observation.collectedAt?.slice(0, 10) ?? '');
                }}
              >
                {editing === entry.review.id ? 'Отмена' : m.reviews.editing}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function parseValueInput(
  input: string,
  observation: MedicalObservation,
): MedicalObservation['value'] {
  const decimal = input.trim().replace(',', '.');
  if (/^-?\d{1,7}(\.\d{1,6})?$/.test(decimal))
    return {
      kind: 'numeric',
      value: decimal,
      comparator:
        observation.value.kind === 'numeric'
          ? observation.value.comparator
          : 'eq',
    };
  return { kind: 'text', value: input.trim() };
}
