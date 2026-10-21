'use client';

import { useRef, useState } from 'react';
import { useElementSize } from '@mantine/hooks';
import Link from 'next/link';
import {
  Alert,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
} from '@tabler/icons-react';
import { PageHeader } from '@/components/layout/page-header';
import { OfflineFile } from '@/components/shared/offline-file';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import {
  anamnesisComparators,
  medicalObservationCorrectionSchema,
  type MedicalObservation,
} from '@/contracts/anamnesis';
import { readResources } from '@/lib/read-descriptors';
import { useReadOnline } from '@/lib/use-read-online';
import { useReadResource } from '@/lib/use-read-resource';
import { useViewState } from '@/lib/use-view-state';
import {
  fetchAnamnesis,
  formatAnamnesisDate,
  formatAnamnesisValue,
  ownerIdQuery,
} from './api';
import { notifyAnamnesisChanged } from './refresh';
import classes from './review-editor.module.css';

type Comparator = (typeof anamnesisComparators)[number];
interface Draft {
  revision: number;
  markerId: string | null;
  value: string;
  comparator: Comparator;
  unit: string;
  date: string;
  precision: 'date' | 'month' | 'datetime';
}
function initialDraft(observation: MedicalObservation): Draft {
  return {
    revision: observation.revision,
    markerId: observation.markerId,
    value:
      observation.value.kind === 'numeric'
        ? observation.value.value.replace('.', ',')
        : observation.value.value,
    comparator:
      observation.value.kind === 'numeric'
        ? observation.value.comparator
        : 'eq',
    unit: observation.originalUnit ?? '',
    date: observation.collectedAt ?? '',
    precision:
      observation.datePrecision === 'datetime' ||
      observation.datePrecision === 'month'
        ? observation.datePrecision
        : 'date',
  };
}

export function ReviewEditor({
  ownerId,
  documentId,
}: {
  ownerId: string;
  documentId: string;
}) {
  const online = useReadOnline();
  const { ref: originalRef, width: originalWidth } = useElementSize();
  const query = ownerIdQuery(ownerId);
  const documentRead = useReadResource(
    readResources.document(`/api/anamnesis/documents/${documentId}?${query}`),
  );
  const reviewsRead = useReadResource(
    readResources.anamnesisReviews(`/api/anamnesis/reviews?${query}`),
  );
  const catalogRead = useReadResource(
    readResources.medicalCatalog(`/api/anamnesis/catalog?${query}`),
  );
  const [selectedId, setSelectedId] = useViewState<string | null>(
    `medical-review:${documentId}:selected`,
    null,
  );
  const [drafts, setDrafts] = useViewState<Record<string, Draft>>(
    `medical-review:${documentId}:drafts`,
    {},
  );
  const [pane, setPane] = useViewState<'form' | 'original'>(
    `medical-review:${documentId}:pane`,
    'form',
  );
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [pageOverride, setPageOverride] = useState<{
    reviewId: string;
    page: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const items = (reviewsRead.data ?? []).filter(
    (entry) =>
      entry.review.documentId === documentId && !resolved.has(entry.review.id),
  );
  const selected =
    items.find((entry) => entry.review.id === selectedId) ?? items[0];
  const index = selected ? items.indexOf(selected) : -1;
  const sources =
    selected?.sources.filter((source) => source.documentId === documentId) ??
    [];
  const sourcePage = sources[0]?.pageNumber ?? 1;
  const page =
    pageOverride?.reviewId === (selected?.review.id ?? '')
      ? pageOverride.page
      : sourcePage;
  const document = documentRead.data;
  const draft = selected
    ? (drafts?.[selected.review.id] ?? initialDraft(selected.observation))
    : undefined;
  const conflict =
    !!selected && draft?.revision !== selected.observation.revision;
  const loading = reviewsRead.data === undefined;
  const loadError =
    reviewsRead.error || documentRead.error || catalogRead.error;
  const fileHref = `/api/anamnesis/documents/${documentId}/file?${query}`;
  const pageCount = document?.pageCount ?? 1;
  function updateDraft(change: Partial<Draft>) {
    if (!selected || !draft) return;
    const id = selected.review.id;
    setDrafts((old) =>
      Object.fromEntries([
        ...Object.entries(old ?? {})
          .filter(([key]) => key !== id)
          .slice(-31),
        [id, { ...draft, ...change }],
      ]),
    );
    setFieldErrors({});
    setError(undefined);
  }
  function choose(id: string) {
    setSelectedId(id);
    setFieldErrors({});
    setError(undefined);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function setPage(next: number) {
    setPageOverride({
      reviewId: selected?.review.id ?? '',
      page: Math.min(pageCount, Math.max(1, next)),
    });
  }
  async function refresh() {
    await Promise.all([
      documentRead.refresh(),
      reviewsRead.refresh(),
      catalogRead.refresh(),
    ]);
  }
  async function act(kind: 'confirm' | 'reject') {
    if (!selected || !draft || busy || !online) return;
    let body: string | undefined;
    if (kind === 'confirm') {
      const decimal = draft.value.trim().replace(',', '.');
      const value: MedicalObservation['value'] = /^-?\d{1,7}(\.\d{1,6})?$/.test(
        decimal,
      )
        ? { kind: 'numeric', value: decimal, comparator: draft.comparator }
        : { kind: 'text', value: draft.value.trim() };
      const correction = medicalObservationCorrectionSchema.safeParse({
        expectedRevision: draft.revision,
        markerId: draft.markerId,
        value,
        originalUnit: draft.unit.trim() || null,
        collectedAt: draft.date,
        datePrecision: draft.precision,
        referenceRange: selected.observation.referenceRange,
      });
      if (!correction.success || !draft.markerId) {
        const fields: Record<string, string> = {};
        if (!draft.markerId) fields.markerId = m.reviews.selectMarker;
        if (
          !draft.date ||
          (!correction.success &&
            correction.error.issues.some(
              (issue) =>
                issue.path[0] === 'collectedAt' ||
                issue.path[0] === 'datePrecision',
            ))
        )
          fields.date = m.reviews.dateInvalid;
        if (
          !draft.value.trim() ||
          (!correction.success &&
            correction.error.issues.some((issue) => issue.path[0] === 'value'))
        )
          fields.value = m.reviews.valueInvalid;
        setFieldErrors(fields);
        setError(m.reviews.invalid);
        requestAnimationFrame(() =>
          form.current
            ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
            ?.focus(),
        );
        return;
      }
      body = JSON.stringify(correction.data);
    }
    setBusy(true);
    setError(undefined);
    try {
      await fetchAnamnesis(
        `/api/anamnesis/reviews/${selected.review.id}/${kind}?${query}`,
        {
          method: 'POST',
          ...(body
            ? { headers: { 'Content-Type': 'application/json' }, body }
            : {}),
        },
      );
      setResolved((old) => new Set([...old, selected.review.id]));
      setDrafts((old) =>
        Object.fromEntries(
          Object.entries(old ?? {}).filter(
            ([key]) => key !== selected.review.id,
          ),
        ),
      );
      setSelectedId((items[index + 1] ?? items[index - 1])?.review.id ?? null);
      setNotice(kind === 'confirm' ? m.reviews.saved : m.reviews.rejected);
      setPane('form');
      notifyAnamnesisChanged();
      await reviewsRead.refresh();
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) {
      const stale =
        cause instanceof Error && 'status' in cause && cause.status === 409;
      setError(stale ? m.reviews.conflict : m.errors.save);
      if (stale) await reviewsRead.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack
      data-content-width="wide"
      data-testid="anamnesis-reviews"
      className={classes.workspace}
    >
      <PageHeader>{m.reviews.workspace}</PageHeader>
      <Group justify="space-between" className={classes.header}>
        <Stack gap={2} className={classes.identity}>
          <Link href="/anamnesis#documents" className={classes.back}>
            <IconArrowLeft size={16} />
            {m.reviews.back}
          </Link>
          <Text fw={600} className={classes.filename}>
            {document?.filename ?? m.reviews.loading}
          </Text>
          {document && (
            <Text size="sm" c="dimmed">
              {document.laboratoryName ?? m.title} · {document.pageCount}{' '}
              {m.documents.column.pages.toLowerCase()}
            </Text>
          )}
        </Stack>
        <Text role="status" size="sm" className={classes.count}>
          {m.reviews.remaining}: {loading ? '…' : items.length}
        </Text>
      </Group>
      {loadError && (
        <Alert color="red" role="alert">
          {m.errors.load}{' '}
          <Button variant="subtle" onClick={() => void refresh()}>
            {m.reviews.retry}
          </Button>
        </Alert>
      )}
      <SegmentedControl<'form' | 'original'>
        className={classes.switcher}
        fullWidth
        value={pane}
        onChange={setPane}
        data={[
          { value: 'form', label: m.reviews.form },
          { value: 'original', label: m.reviews.original },
        ]}
      />
      <div className={classes.columns}>
        <Paper
          withBorder
          className={classes.formPane}
          data-visible={pane === 'form'}
        >
          <div className={classes.formContent}>
            {loading && <Text role="status">{m.reviews.loading}</Text>}
            {!loading && !selected && (
              <Stack py="xl">
                <Title ref={heading} tabIndex={-1} order={2} size="h3">
                  {m.reviews.complete}
                </Title>
                <Text c="dimmed">{m.reviews.completeHint}</Text>
                <Button
                  component={Link}
                  href="/anamnesis#documents"
                  variant="default"
                >
                  {m.reviews.back}
                </Button>
              </Stack>
            )}
            {selected && draft && (
              <>
                <Group wrap="nowrap" align="flex-end" gap="xs">
                  <Select
                    className={classes.grow}
                    label={m.reviews.queue}
                    searchable
                    allowDeselect={false}
                    value={selected.review.id}
                    onChange={(id) => {
                      if (id) choose(id);
                    }}
                    disabled={busy}
                    data={items.map((entry, i) => ({
                      value: entry.review.id,
                      label: `${i + 1}. ${entry.observation.originalName}`,
                    }))}
                    nothingFoundMessage={m.reviews.searchEmpty}
                  />
                  <Button
                    variant="default"
                    px="xs"
                    aria-label={m.reviews.previous}
                    disabled={busy || index <= 0}
                    onClick={() => {
                      const previous = items[index - 1];
                      if (previous) choose(previous.review.id);
                    }}
                  >
                    <IconChevronLeft size={18} />
                  </Button>
                  <Button
                    variant="default"
                    px="xs"
                    aria-label={m.reviews.next}
                    disabled={busy || index >= items.length - 1}
                    onClick={() => {
                      const next = items[index + 1];
                      if (next) choose(next.review.id);
                    }}
                  >
                    <IconChevronRight size={18} />
                  </Button>
                </Group>
                <div className={classes.resultHeading}>
                  <Title ref={heading} tabIndex={-1} order={2} size="h3">
                    {selected.observation.originalName}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {m.reviewReason[selected.review.reason]}
                  </Text>
                </div>
                <div className={classes.source}>
                  <Text size="xs" c="dimmed">
                    {m.reviews.source}
                  </Text>
                  <Text fw={600}>
                    {formatAnamnesisValue(selected.observation.value)}{' '}
                    {selected.observation.originalUnit}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {formatAnamnesisDate(selected.observation.collectedAt)}
                  </Text>
                  {sources.map((source) => (
                    <div key={source.id}>
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        className={classes.sourceLink}
                        onClick={() => {
                          setPage(source.pageNumber);
                          setPane('original');
                        }}
                      >
                        {m.reviews.sourcePage} {source.pageNumber}
                      </Button>
                      <Text size="sm" className={classes.quote}>
                        «{source.rawText}»
                      </Text>
                    </div>
                  ))}
                </div>
                {error && (
                  <Alert color="red" role="alert">
                    {error}
                  </Alert>
                )}
                {conflict && (
                  <Alert color="orange">
                    {m.reviews.conflict}
                    <Button
                      variant="subtle"
                      onClick={() =>
                        updateDraft(initialDraft(selected.observation))
                      }
                    >
                      {m.reviews.reload}
                    </Button>
                  </Alert>
                )}
                <form
                  ref={form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act('confirm');
                  }}
                  className={classes.form}
                >
                  <Select
                    label={m.reviews.fields.marker}
                    placeholder={m.reviews.selectMarker}
                    searchable
                    allowDeselect={false}
                    data={(catalogRead.data ?? []).map((marker) => ({
                      value: marker.id,
                      label: marker.name,
                    }))}
                    value={draft.markerId}
                    onChange={(markerId) => updateDraft({ markerId })}
                    error={fieldErrors.markerId}
                    nothingFoundMessage={m.reviews.searchEmpty}
                    disabled={busy || !catalogRead.data}
                    required
                  />
                  <div className={classes.pair}>
                    <TextInput
                      label={m.reviews.fields.value}
                      value={draft.value}
                      onChange={(event) =>
                        updateDraft({ value: event.currentTarget.value })
                      }
                      error={fieldErrors.value}
                      disabled={busy}
                      required
                      maxLength={500}
                    />
                    <TextInput
                      label={m.reviews.fields.unit}
                      value={draft.unit}
                      onChange={(event) =>
                        updateDraft({ unit: event.currentTarget.value })
                      }
                      disabled={busy}
                      maxLength={30}
                    />
                  </div>
                  <Select
                    label={m.reviews.comparator}
                    value={draft.comparator}
                    allowDeselect={false}
                    data={anamnesisComparators.map((value) => ({
                      value,
                      label: m.reviews.comparatorLabels[value],
                    }))}
                    onChange={(value) => {
                      if (value)
                        updateDraft({ comparator: value as Comparator });
                    }}
                    disabled={busy}
                  />
                  <div className={classes.datePair}>
                    <TextInput
                      type={
                        draft.precision === 'datetime'
                          ? 'datetime-local'
                          : draft.precision
                      }
                      step={draft.precision === 'datetime' ? 1 : undefined}
                      label={m.reviews.fields.date}
                      value={draft.date}
                      onChange={(event) =>
                        updateDraft({ date: event.currentTarget.value })
                      }
                      error={fieldErrors.date}
                      disabled={busy}
                      required
                    />
                    <Select
                      label={m.reviews.precision}
                      value={draft.precision}
                      allowDeselect={false}
                      data={[
                        { value: 'date', label: m.reviews.precisionDate },
                        { value: 'month', label: m.reviews.precisionMonth },
                        { value: 'datetime', label: m.reviews.precisionTime },
                      ]}
                      onChange={(value) => {
                        if (
                          value === 'date' ||
                          value === 'month' ||
                          value === 'datetime'
                        )
                          updateDraft({
                            precision: value,
                            date: draft.date.slice(
                              0,
                              value === 'month'
                                ? 7
                                : value === 'date'
                                  ? 10
                                  : 19,
                            ),
                          });
                      }}
                      disabled={busy}
                    />
                  </div>
                  {selected.observation.referenceRange && (
                    <div>
                      <Text size="sm" c="dimmed">
                        {m.reviews.fields.reference}
                      </Text>
                      <Text size="sm">
                        {selected.observation.referenceRange.originalText}
                      </Text>
                    </div>
                  )}
                  {!online && (
                    <Text size="sm" c="dimmed">
                      {m.reviews.offline}
                    </Text>
                  )}
                  <div className={classes.actions}>
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={!online || conflict || !catalogRead.data}
                    >
                      {m.reviews.confirmNext}
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      disabled={busy || !online}
                      onClick={() => void act('reject')}
                    >
                      {m.reviews.reject}
                    </Button>
                  </div>
                </form>
              </>
            )}
            <Text role="status" aria-live="polite" size="sm" c="dimmed">
              {notice}
            </Text>
          </div>
        </Paper>
        <Paper
          withBorder
          className={classes.originalPane}
          ref={originalRef}
          data-visible={pane === 'original'}
          aria-label={m.reviews.original}
        >
          <div className={classes.pdfToolbar}>
            <Group gap="xs" wrap="nowrap">
              <Button
                variant="default"
                px="xs"
                aria-label={m.reviews.previousPage}
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <IconChevronLeft size={18} />
              </Button>
              <Select
                aria-label={m.reviews.page}
                value={String(page)}
                onChange={(value) => {
                  if (value) setPage(Number(value));
                }}
                data={Array.from({ length: pageCount }, (_, i) => ({
                  value: String(i + 1),
                  label: `${m.reviews.page} ${i + 1} ${m.reviews.of} ${pageCount}`,
                }))}
                allowDeselect={false}
                className={classes.pageSelect}
              />
              <Button
                variant="default"
                px="xs"
                aria-label={m.reviews.nextPage}
                disabled={page >= pageCount}
                onClick={() => setPage(page + 1)}
              >
                <IconChevronRight size={18} />
              </Button>
            </Group>
            {online && (
              <Button
                component="a"
                href={`${fileHref}#page=${page}`}
                target="_blank"
                rel="noreferrer"
                variant="subtle"
                rightSection={<IconExternalLink size={16} />}
                className={classes.openPdf}
              >
                {m.reviews.openPdf}
              </Button>
            )}
          </div>
          {document && online ? (
            <iframe
              key={`${page}:${Math.round(originalWidth)}`}
              src={`${fileHref}#page=${page}&zoom=page-width&navpanes=0`}
              className={classes.pdf}
              title={`${document.filename}, ${m.reviews.page} ${page}`}
            />
          ) : (
            <Stack p="md">
              <Text c="dimmed">
                {online ? m.reviews.loading : m.reviews.originalOffline}
              </Text>
              {document && (
                <OfflineFile
                  id={`medical-document:${document.id}`}
                  label={document.filename}
                  kind="pdf"
                  size={document.sizeBytes}
                  href={fileHref}
                  offline={!online}
                />
              )}
            </Stack>
          )}
        </Paper>
      </div>
    </Stack>
  );
}
