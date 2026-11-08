'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  FileInput,
  Group,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  techniqueDescriptionMax,
  type TechniqueEditorData,
} from '@/contracts/exercise-technique';
import {
  VIDEO_INPUT_MAX_BYTES,
  VIDEO_PART_BYTES,
} from '@/contracts/workout-videos';
import {
  requestExerciseTechnique,
  techniqueEditorHref,
  TechniqueRequestError,
} from '@/lib/exercise-technique-client';
import { useViewState } from '@/lib/use-view-state';
import { revalidateVisibleReads } from '@/lib/client-read';
import { workoutMessages as m } from './messages';
import { sendVideoPart } from './video-upload';

export function ExerciseTechniqueEditor({
  ownerId,
  exerciseId,
  scope,
  opened,
  close,
}: {
  ownerId: string;
  exerciseId: number;
  scope: string;
  opened: boolean;
  close: () => void;
}) {
  const [state, setState] = useState<TechniqueEditorData>();
  const [draft, setDraft] = useViewState<
    { text: string; revision: number } | undefined
  >(`exercise-technique-description:${scope}`, undefined);
  const [descriptionError, setDescriptionError] = useState('');
  const [conflictRevision, setConflictRevision] = useState<number>();
  const [notice, setNotice] = useState('');
  const [videoError, setVideoError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<'description' | 'video'>();
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const fileRequest = useRef<{ file: File; id: string; sent: Set<number> }>(
    null,
  );
  const active = useRef<AbortController>(null);
  const epoch = useRef(0);

  const request = useCallback(
    (path = '', init: RequestInit = {}, query = '') =>
      requestExerciseTechnique(
        techniqueEditorHref(ownerId, exerciseId, path) + query,
        scope,
        { ...init, signal: active.current?.signal },
      ),
    [ownerId, exerciseId, scope],
  );

  const refresh = useCallback(async () => {
    const token = epoch.current;
    const signal = active.current?.signal;
    try {
      const next = await request();
      if (token !== epoch.current) return;
      setState(next);
      setUnavailable(false);
      return next;
    } catch {
      if (token === epoch.current && !signal?.aborted) setUnavailable(true);
    }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    void request().then(
      (next) => {
        if (!controller.signal.aborted) setState(next);
      },
      () => {
        if (!controller.signal.aborted) setUnavailable(true);
      },
    );
    return () => controller.abort();
  }, [request]);

  const processing = state?.candidate?.state === 'processing';
  useEffect(() => {
    if (!processing || busy) return;
    let pending = false;
    const timer = setInterval(() => {
      if (document.hidden || pending) return;
      pending = true;
      void refresh().finally(() => {
        pending = false;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, processing, refresh]);
  const publishedId = state?.videoId;
  const previousPublishedId = useRef(publishedId);
  useEffect(() => {
    if (
      previousPublishedId.current !== undefined &&
      previousPublishedId.current !== publishedId
    )
      revalidateVisibleReads(true);
    previousPublishedId.current = publishedId;
  }, [publishedId]);

  async function saveDescription(event: React.SubmitEvent) {
    event.preventDefault();
    if (!state || busy || draft === undefined) return;
    epoch.current++;
    setBusy('description');
    setDescriptionError('');
    setNotice('');
    try {
      setState(
        await request('', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope,
            revision: conflictRevision ?? draft.revision,
            description: draft.text,
          }),
        }),
      );
      setDraft(undefined);
      setConflictRevision(undefined);
      setNotice(m.techniqueSaved);
      revalidateVisibleReads(true);
    } catch (error) {
      if (error instanceof TechniqueRequestError && error.status === 409) {
        setDescriptionError(m.techniqueDescriptionConflict);
        const current = await refresh();
        setConflictRevision(current?.revision);
      } else {
        setDescriptionError(m.error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function changeVideo(action: () => Promise<TechniqueEditorData>) {
    if (busy) return;
    epoch.current++;
    setBusy('video');
    setVideoError('');
    try {
      setState(await action());
      setFile(null);
      fileRequest.current = null;
      setConfirmRemoval(false);
    } catch (error) {
      setVideoError(
        error instanceof TechniqueRequestError && error.status === 409
          ? m.conflict
          : m.videoUploadError,
      );
      await refresh();
    } finally {
      setBusy(undefined);
      setUploadProgress(undefined);
    }
  }

  function upload() {
    if (!file || !state || busy) return;
    if (file.size <= 0 || file.size > VIDEO_INPUT_MAX_BYTES) {
      setVideoError(m.techniqueTooLarge);
      return;
    }
    const name = file.name.trim().slice(0, 240);
    const lastModified = file.lastModified || undefined;
    const candidate = state.candidate;
    if (
      candidate &&
      (candidate.name !== name ||
        candidate.size !== file.size ||
        candidate.lastModified !== (lastModified ?? null))
    ) {
      setVideoError(m.techniqueFileMismatch);
      return;
    }
    const previous = fileRequest.current;
    const id =
      candidate?.id ??
      (previous?.file === file ? previous.id : crypto.randomUUID());
    const sent =
      previous?.file === file && previous.id === id
        ? previous.sent
        : new Set<number>();
    fileRequest.current = { file, id, sent };
    void changeVideo(async () => {
      const started = await request('/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
        body: JSON.stringify({ scope, size: file.size, name, lastModified }),
      });
      if (started.videoId === id) return started;
      if (started.candidate?.id !== id) throw new TechniqueRequestError(409);
      if (started.candidate.state === 'uploading') {
        // On a reselected file, resend acknowledged parts so the server compares
        // their digest before accepting the remaining bytes.
        const acknowledged = new Set(
          started.candidate.parts.filter((part) => sent.has(part)),
        );
        const signal = active.current!.signal;
        for (
          let offset = 0, part = 0;
          offset < file.size;
          offset += VIDEO_PART_BYTES, part++
        ) {
          const chunk = file.slice(offset, offset + VIDEO_PART_BYTES);
          const progress = () =>
            setUploadProgress((offset + chunk.size) / file.size);
          if (acknowledged.has(part)) progress();
          else
            await sendVideoPart(
              techniqueEditorHref(
                ownerId,
                exerciseId,
                `/videos/${id}/parts/${part}`,
              ),
              chunk,
              signal,
              progress,
            );
          sent.add(part);
        }
      }
      return request(`/videos/${id}/finalize`, { method: 'POST' });
    });
  }

  const candidate = state?.candidate;
  const draftValue = draft?.text ?? state?.description ?? '';
  return (
    <div hidden={!opened}>
      <Paper
        component="section"
        withBorder
        p="md"
        radius="md"
        aria-label={m.techniqueEditor}
      >
        <Stack gap="md">
          <Group justify="space-between" gap="xs">
            <Title order={2} size="h4">
              {m.techniqueEditor}
            </Title>
            <Button variant="subtle" color="gray" onClick={close} mih={44}>
              {m.finishTechniqueEdit}
            </Button>
          </Group>
          {unavailable && (
            <Alert color="orange" role="alert">
              {m.techniqueUnavailable}{' '}
              <Button variant="subtle" onClick={() => void refresh()}>
                {m.refresh}
              </Button>
            </Alert>
          )}
          {!state && !unavailable && (
            <Loader size="sm" aria-label={m.loading} />
          )}
          {state && (
            <>
              <form onSubmit={saveDescription}>
                <Stack gap="xs">
                  <Textarea
                    label={m.techniqueDescription}
                    description={m.techniqueDescriptionHint}
                    value={draftValue}
                    onChange={(event) =>
                      setDraft({
                        text: event.currentTarget.value,
                        revision: draft?.revision ?? state.revision,
                      })
                    }
                    disabled={busy === 'description'}
                    maxLength={techniqueDescriptionMax}
                    autosize
                    minRows={3}
                    maxRows={10}
                  />
                  {descriptionError && (
                    <Alert color="orange" role="alert">
                      {descriptionError}
                      {descriptionError === m.techniqueDescriptionConflict &&
                        state.description && (
                          <Text
                            size="sm"
                            mt="xs"
                            style={{
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {state.description}
                          </Text>
                        )}
                    </Alert>
                  )}
                  <Group>
                    <Button
                      type="submit"
                      mih={44}
                      loading={busy === 'description'}
                      disabled={
                        Boolean(busy) || draftValue.trim() === state.description
                      }
                    >
                      {m.saveTechniqueDescription}
                    </Button>
                    {notice && (
                      <Text size="sm" role="status">
                        {notice}
                      </Text>
                    )}
                  </Group>
                </Stack>
              </form>
              <Divider />
              <Stack gap="xs">
                <Title order={3} size="h5">
                  {m.techniqueVideoTitle}
                </Title>
                {state.videoId && (
                  <Text size="sm" role="status">
                    {m.techniqueVideoReady}
                  </Text>
                )}
                {videoError && (
                  <Alert color="red" role="alert">
                    {videoError}
                  </Alert>
                )}
                {candidate?.state === 'failed' && (
                  <Alert color="red" role="alert">
                    {candidate.error === 'invalid'
                      ? m.videoInvalid
                      : m.videoProcessingFailed}
                  </Alert>
                )}
                {candidate?.state === 'processing' && (
                  <Stack gap={4}>
                    <Text size="sm" role="status">
                      {m.videoProcessing}
                    </Text>
                    <Progress
                      value={100 * candidate.progress}
                      aria-label={m.videoProgress}
                    />
                  </Stack>
                )}
                {uploadProgress !== undefined && (
                  <Stack gap={4}>
                    <Text size="sm" role="status">
                      {m.videoUploading}
                    </Text>
                    <Progress
                      value={100 * uploadProgress}
                      aria-label={m.videoProgress}
                    />
                  </Stack>
                )}
                {(!candidate || candidate.state === 'uploading') && (
                  <FileInput
                    label={m.techniqueFile}
                    description={
                      candidate
                        ? `${candidate.name}. ${m.reselectTechniqueFile}`
                        : m.techniqueVideoLimits
                    }
                    placeholder={m.chooseTechniqueFile}
                    value={file}
                    onChange={setFile}
                    accept="video/*,.mov,.mp4,.m4v,.webm,.avi,.mkv"
                    disabled={Boolean(busy)}
                    clearable
                  />
                )}
                <Group gap="xs">
                  {(!candidate || candidate.state === 'uploading') && (
                    <Button
                      variant="light"
                      mih={44}
                      onClick={upload}
                      disabled={!file || Boolean(busy)}
                    >
                      {candidate
                        ? m.videoResume
                        : state.videoId
                          ? m.replaceTechniqueVideo
                          : m.addTechniqueVideo}
                    </Button>
                  )}
                  {candidate?.state === 'failed' &&
                    candidate.error !== 'invalid' && (
                      <Button
                        variant="light"
                        mih={44}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void changeVideo(() =>
                            request(`/videos/${candidate.id}/finalize`, {
                              method: 'POST',
                            }),
                          )
                        }
                      >
                        {m.videoRetryShort}
                      </Button>
                    )}
                  {candidate && (
                    <Button
                      variant="subtle"
                      color="gray"
                      mih={44}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void changeVideo(() =>
                          request(
                            `/videos/${candidate.id}`,
                            { method: 'DELETE' },
                            '&slot=candidate',
                          ),
                        )
                      }
                    >
                      {m.cancelTechniqueUpload}
                    </Button>
                  )}
                  {state.videoId && !candidate && !confirmRemoval && (
                    <Button
                      variant="subtle"
                      color="red"
                      mih={44}
                      disabled={Boolean(busy)}
                      onClick={() => setConfirmRemoval(true)}
                    >
                      {m.removeTechniqueVideo}
                    </Button>
                  )}
                </Group>
                {state.videoId && !candidate && confirmRemoval && (
                  <Alert color="red">
                    <Text size="sm">{m.confirmTechniqueRemoval}</Text>
                    <Group gap="xs" mt="xs">
                      <Button
                        color="red"
                        mih={44}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void changeVideo(() =>
                            request(
                              `/videos/${state.videoId}`,
                              { method: 'DELETE' },
                              '&slot=ready',
                            ),
                          )
                        }
                      >
                        {m.removeTechniqueVideo}
                      </Button>
                      <Button
                        variant="subtle"
                        color="gray"
                        mih={44}
                        onClick={() => setConfirmRemoval(false)}
                      >
                        {m.cancel}
                      </Button>
                    </Group>
                  </Alert>
                )}
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    </div>
  );
}
