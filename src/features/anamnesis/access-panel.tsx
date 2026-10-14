'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import type {
  AnamnesisAccess,
  AnamnesisMarkerSummary,
  MedicalDocument,
} from '@/contracts/anamnesis';
import { anamnesisMessages as m } from './messages';
import { fetchAnamnesis, ownerIdQuery } from './api';

// Выборочный доступ: маркеры и документы переключаются независимо;
// разрешения действуют, пока тренер имеет общий доступ к данным.
export function AccessPanel({ ownerId }: { ownerId: string }) {
  const [access, setAccess] = useState<AnamnesisAccess>();
  const [markers, setMarkers] = useState<AnamnesisMarkerSummary[]>([]);
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const query = ownerIdQuery(ownerId);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [loadedAccess, markerList, documentList] = await Promise.all([
          fetchAnamnesis<AnamnesisAccess>(`/api/anamnesis/access?${query}`),
          fetchAnamnesis<AnamnesisMarkerSummary[]>(
            `/api/anamnesis/markers?${query}`,
          ),
          fetchAnamnesis<MedicalDocument[]>(
            `/api/anamnesis/documents?${query}`,
          ),
        ]);
        if (active) {
          setAccess(loadedAccess);
          setMarkers(markerList);
          setDocuments(documentList);
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

  async function toggleMarker(
    trainerId: string,
    markerId: string,
    enabled: boolean,
  ) {
    setError(undefined);
    try {
      await fetchAnamnesis(
        `/api/anamnesis/access/markers/${markerId}?${query}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trainerId, enabled }),
        },
      );
      setAccess((old) =>
        old
          ? {
              trainers: old.trainers.map((trainer) =>
                trainer.trainerId === trainerId
                  ? {
                      ...trainer,
                      markerIds: enabled
                        ? [...trainer.markerIds, markerId]
                        : trainer.markerIds.filter((id) => id !== markerId),
                    }
                  : trainer,
              ),
            }
          : old,
      );
    } catch {
      setError(m.errors.save);
    }
  }

  async function toggleDocument(
    trainerId: string,
    documentId: string,
    enabled: boolean,
  ) {
    setError(undefined);
    try {
      await fetchAnamnesis(
        `/api/anamnesis/access/documents/${documentId}?${query}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trainerId, enabled }),
        },
      );
      setAccess((old) =>
        old
          ? {
              trainers: old.trainers.map((trainer) =>
                trainer.trainerId === trainerId
                  ? {
                      ...trainer,
                      documentIds: enabled
                        ? [...trainer.documentIds, documentId]
                        : trainer.documentIds.filter((id) => id !== documentId),
                    }
                  : trainer,
              ),
            }
          : old,
      );
    } catch {
      setError(m.errors.save);
    }
  }

  return (
    <Stack data-testid="anamnesis-access">
      <Title order={1}>{m.access.title}</Title>
      <Text size="sm" c="dimmed">
        {m.access.description}
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {loading && <Text>…</Text>}
      {!loading && !access?.trainers.length && <Text>{m.access.empty}</Text>}
      {access?.trainers.map((trainer) => (
        <Paper
          key={trainer.trainerId}
          withBorder
          p="md"
          data-testid="anamnesis-access-trainer"
        >
          <Group mb="sm">
            <Text fw={600}>{trainer.name}</Text>
            <Badge variant="light">
              {m.access.markers}: {trainer.markerIds.length}
            </Badge>
            <Badge variant="light">
              {m.access.documents}: {trainer.documentIds.length}
            </Badge>
          </Group>
          <Title order={4}>{m.access.markers}</Title>
          <Stack gap="xs" mb="sm">
            {markers.map((item) => (
              <Switch
                key={item.marker.id}
                label={item.marker.name}
                checked={trainer.markerIds.includes(item.marker.id)}
                onChange={(event) =>
                  void toggleMarker(
                    trainer.trainerId,
                    item.marker.id,
                    event.currentTarget.checked,
                  )
                }
              />
            ))}
            {!markers.length && <Text>{m.markers.empty}</Text>}
          </Stack>
          <Title order={4}>{m.access.documents}</Title>
          <Stack gap="xs">
            {documents.map((item) => (
              <Switch
                key={item.id}
                label={item.filename}
                checked={trainer.documentIds.includes(item.id)}
                onChange={(event) =>
                  void toggleDocument(
                    trainer.trainerId,
                    item.id,
                    event.currentTarget.checked,
                  )
                }
              />
            ))}
            {!documents.length && <Text>{m.documents.empty}</Text>}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
