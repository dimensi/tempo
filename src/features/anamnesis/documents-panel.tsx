'use client';

import { ReviewEditor } from './review-editor';
import { notifyAnamnesisChanged, useAnamnesisRevision } from './refresh';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  FileInput,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { MedicalDocument, MedicalImportJob } from '@/contracts/anamnesis';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { fetchAnamnesis, formatAnamnesisDate, ownerIdQuery } from './api';

export function DocumentsPanel({
  ownerId,
  writable,
}: {
  ownerId: string;
  writable: boolean;
}) {
  const revision = useAnamnesisRevision();
  const [pending, setPending] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<MedicalImportJob[]>([]);
  const [reviewing, setReviewing] = useState<string>();
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
  }, [query, revision]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await fetchAnamnesis<MedicalImportJob[]>(
          `/api/anamnesis/imports?${query}`,
          { cache: 'no-store' },
        );
        if (!active) return;
        setJobs((old) => {
          if (
            old.some(
              (job) =>
                ['queued', 'processing'].includes(job.status) &&
                next.some(
                  (item) =>
                    item.id === job.id &&
                    !['queued', 'processing'].includes(item.status),
                ),
            )
          )
            queueMicrotask(notifyAnamnesisChanged);
          return next;
        });
        if (next.some((job) => ['queued', 'processing'].includes(job.status)))
          timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (active) setError(m.errors.load);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, revision]);

  useEffect(() => {
    if (!writable) return;
    const controller = new AbortController();
    void fetchAnamnesis<Array<{ review: { documentId: string } }>>(
      `/api/anamnesis/reviews?${query}`,
      { signal: controller.signal, cache: 'no-store' },
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const counts: Record<string, number> = {};
        rows.forEach(({ review }) => {
          counts[review.documentId] = (counts[review.documentId] ?? 0) + 1;
        });
        setPending(counts);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(m.errors.load);
      });
    return () => controller.abort();
  }, [query, revision, writable]);

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
      notifyAnamnesisChanged();
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
      notifyAnamnesisChanged();
    } catch {
      setError(m.errors.save);
    } finally {
      setBusy(false);
    }
  }

  if (denied)
    return (
      <Stack data-testid="anamnesis-documents">
        <Title order={2}>{m.workspace.documents}</Title>
        <Alert color="red" role="alert">
          {m.documents.readOnly}
        </Alert>
      </Stack>
    );

  return (
    <Stack data-testid="anamnesis-documents">
      <Title order={2}>{m.workspace.documents}</Title>
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
      {items.map((item) => {
        const job = jobs
          .filter((job) => job.documentId === item.id)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return (
          <Paper
            key={item.id}
            withBorder
            p="md"
            id={`document-${item.id}`}
            tabIndex={-1}
          >
            <Stack>
              <Group justify="space-between">
                <Link href={`/anamnesis/documents/${item.id}`}>
                  {item.filename}
                </Link>
                <Text size="sm">
                  {item.pageCount} {m.documents.column.pages.toLowerCase()}
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                {item.laboratoryName ?? '—'} ·{' '}
                {formatAnamnesisDate(item.collectedAt ?? item.issuedAt)}
              </Text>
              {job && (
                <Text role="status">
                  {m.imports.status[job.status]} · {m.imports.stage[job.stage]}
                </Text>
              )}
              {job?.lastError && <Alert color="red">{job.lastError}</Alert>}
              {writable && (
                <Group>
                  <Button
                    variant="default"
                    onClick={() =>
                      setReviewing((old) =>
                        old === item.id ? undefined : item.id,
                      )
                    }
                  >
                    {m.reviews.title} ({pending[item.id] ?? 0})
                  </Button>
                  <Button
                    color="red"
                    variant="subtle"
                    onClick={() => setDeleting(item.id)}
                  >
                    {m.documents.delete}
                  </Button>
                </Group>
              )}
              {deleting === item.id && (
                <Group>
                  <Button
                    color="red"
                    loading={busy}
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
              )}
              {reviewing === item.id && (
                <ReviewEditor ownerId={ownerId} documentId={item.id} />
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
