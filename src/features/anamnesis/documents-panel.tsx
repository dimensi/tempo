'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  FileInput,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { MedicalDocument, MedicalImportJob } from '@/contracts/anamnesis';
import { anamnesisMessages as m } from './messages';
import { fetchAnamnesis, formatAnamnesisDate, ownerIdQuery } from './api';

export function DocumentsPanel({
  ownerId,
  writable,
}: {
  ownerId: string;
  writable: boolean;
}) {
  const [items, setItems] = useState<MedicalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [denied, setDenied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const query = ownerIdQuery(ownerId);

  useEffect(() => {
    let active = true;
    fetchAnamnesis<MedicalDocument[]>(`/api/anamnesis/documents?${query}`)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (
          cause instanceof Error &&
          'status' in cause &&
          (cause as { status: number }).status === 403
        ) {
          setDenied(true);
          return;
        }
        setError(m.errors.load);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await fetchAnamnesis<{
        document: MedicalDocument;
        importJob: MedicalImportJob | null;
        duplicate: boolean;
      }>(`/api/anamnesis/documents/uploads?${query}`, {
        method: 'POST',
        body: form,
      });
      setNotice(result.duplicate ? m.documents.duplicate : undefined);
      if (!result.duplicate && result.importJob) {
        setItems((old) => [result.document, ...old]);
      }
      setFile(null);
    } catch (cause) {
      setError(
        cause instanceof Error &&
          'status' in cause &&
          (cause as { status: number }).status === 413
          ? m.documents.uploadHint
          : m.errors.upload,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      await fetchAnamnesis(`/api/anamnesis/documents/${id}?${query}`, {
        method: 'DELETE',
      });
      setItems((old) => old.filter((item) => item.id !== id));
      setDeleting(undefined);
    } catch {
      setError(m.errors.save);
    } finally {
      setBusy(false);
    }
  }

  if (denied)
    return (
      <Stack data-testid="anamnesis-documents">
        <Title order={1}>{m.documents.title}</Title>
        <Alert color="red" role="alert">
          {m.documents.readOnly}
        </Alert>
      </Stack>
    );

  return (
    <Stack data-testid="anamnesis-documents">
      <Title order={1}>{m.documents.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert color="blue" role="status">
          {notice}
        </Alert>
      )}
      {writable && (
        <Paper withBorder p="md">
          <Group align="flex-end">
            <FileInput
              label={m.documents.upload}
              placeholder="report.pdf"
              accept="application/pdf"
              value={file}
              onChange={setFile}
              style={{ flex: 1 }}
            />
            <Button
              onClick={() => void upload()}
              loading={busy}
              disabled={!file}
              mih={44}
            >
              {m.documents.upload}
            </Button>
          </Group>
          <Text size="sm" c="dimmed" mt="xs">
            {m.documents.uploadHint}
          </Text>
        </Paper>
      )}
      {!writable && <Text>{m.documents.readOnly}</Text>}
      {loading && <Text>…</Text>}
      {!loading && !items.length && <Text>{m.documents.empty}</Text>}
      {!!items.length && (
        <Table.ScrollContainer minWidth={640}>
          <Table data-testid="anamnesis-document-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{m.documents.column.filename}</Table.Th>
                <Table.Th>{m.documents.column.laboratory}</Table.Th>
                <Table.Th>{m.documents.column.date}</Table.Th>
                <Table.Th>{m.documents.column.pages}</Table.Th>
                {writable && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Link href={`/anamnesis/documents/${item.id}`}>
                      {item.filename}
                    </Link>
                  </Table.Td>
                  <Table.Td>{item.laboratoryName ?? '—'}</Table.Td>
                  <Table.Td>
                    {formatAnamnesisDate(item.collectedAt ?? item.issuedAt)}
                  </Table.Td>
                  <Table.Td>{item.pageCount}</Table.Td>
                  {writable && (
                    <Table.Td>
                      {deleting === item.id ? (
                        <Group>
                          <Button
                            color="red"
                            mih={44}
                            onClick={() => void remove(item.id)}
                          >
                            {m.documents.delete}
                          </Button>
                          <Button
                            variant="default"
                            onClick={() => setDeleting(undefined)}
                          >
                            Отмена
                          </Button>
                        </Group>
                      ) : (
                        <Button
                          color="red"
                          variant="light"
                          mih={44}
                          disabled={busy}
                          onClick={() => setDeleting(item.id)}
                        >
                          {m.documents.delete}
                        </Button>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
