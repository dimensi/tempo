'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Stack, Table, Text, Title } from '@mantine/core';
import type { MedicalImportJob } from '@/contracts/anamnesis';
import { anamnesisMessages as m } from './messages';
import { fetchAnamnesis, ownerIdQuery } from './api';

// Очередь импорта: состояние переживает перезагрузку страницы (серверная очередь),
// опрос продолжается пока есть активные задания.
export function ImportQueue({ ownerId }: { ownerId: string }) {
  const [items, setItems] = useState<MedicalImportJob[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const url = `/api/anamnesis/imports?${ownerIdQuery(ownerId)}`;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await fetchAnamnesis<MedicalImportJob[]>(url);
        if (!active) return;
        setItems(data);
        setError(undefined);
        if (
          data.some(
            (job) => job.status === 'queued' || job.status === 'processing',
          )
        ) {
          timer = setTimeout(() => void poll(), 2000);
        }
      } catch {
        if (active) setError(m.errors.load);
      } finally {
        if (active) setLoading(false);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [url]);

  return (
    <Stack data-testid="anamnesis-imports">
      <Title order={1}>{m.imports.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {loading && <Text>…</Text>}
      {!loading && !items.length && <Text>{m.imports.empty}</Text>}
      {!!items.length && (
        <Table.ScrollContainer minWidth={640}>
          <Table data-testid="anamnesis-import-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{m.imports.column.document}</Table.Th>
                <Table.Th>{m.imports.column.status}</Table.Th>
                <Table.Th>{m.imports.column.stage}</Table.Th>
                <Table.Th>{m.imports.column.updated}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr
                  key={item.id}
                  data-testid={`anamnesis-import-${item.status}`}
                >
                  <Table.Td>{item.documentId.slice(0, 8)}…</Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        item.status === 'completed'
                          ? 'green'
                          : item.status === 'failed'
                            ? 'red'
                            : item.status === 'completed_with_warnings'
                              ? 'orange'
                              : 'blue'
                      }
                      variant="light"
                    >
                      {m.imports.status[item.status]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{m.imports.stage[item.stage]}</Table.Td>
                  <Table.Td>
                    {new Date(item.updatedAt).toLocaleString('ru-RU')}
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
