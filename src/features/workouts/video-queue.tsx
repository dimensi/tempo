'use client';
import {
  VIDEO_PART_BYTES,
  type WorkoutVideo,
} from '@/contracts/workout-videos';
import { apiFetch } from '@/lib/api-client';
import { subscribeLocalDataReset } from '@/lib/local-data';
import { subscribeSessionReset } from '@/lib/offline-device';
import { sessionGeneration } from '@/lib/session-state';
import {
  createVideoDraftStore,
  type VideoDraft,
} from '@/lib/workout-video-draft';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import type { FilePondFile, FilePondInitialFile } from 'filepond';
import { FilePond } from 'react-filepond';
import { useEffect, useRef, useState } from 'react';
import 'filepond/dist/filepond.min.css';
import { compressWorkoutVideo } from './compress-video';
import { workoutMessages as m } from './messages';
import { sendVideoPart } from './video-upload';
import classes from './video-queue.module.css';
type Entry = {
  id: string;
  draft?: VideoDraft;
  restored?: boolean;
  completed?: boolean;
  controller?: AbortController;
};
export default function VideoQueue({
  ownerId,
  sessionId,
  exerciseId,
  videos,
  refresh,
}: {
  ownerId: string;
  sessionId: string;
  exerciseId: string;
  videos: WorkoutVideo[];
  refresh: (signal?: AbortSignal) => Promise<WorkoutVideo[]>;
}) {
  const pond = useRef<FilePond>(null);
  const entries = useRef(new Map<string, Entry>());
  const store = useRef<ReturnType<typeof createVideoDraftStore> | null>(null);
  const epoch = useRef(0);
  const serial = useRef<Promise<void>>(Promise.resolve());
  const [initialized, setInitialized] = useState(false);
  const [stage, setStage] = useState('');
  const alive = useRef(false);
  const [initial, setInitial] = useState<FilePondInitialFile[]>([]);
  const [items, setItems] = useState<FilePondFile[]>([]);
  const [warning, setWarning] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const base = '/api/workouts/videos';
  const query = `?ownerId=${encodeURIComponent(ownerId)}`;
  const scope = `${ownerId}:${sessionId}:${exerciseId}`;
  const generation = sessionGeneration();
  function current(token: number, session: number) {
    return (
      alive.current &&
      token === epoch.current &&
      session === sessionGeneration()
    );
  }
  function stop() {
    for (const entry of entries.current.values()) entry.controller?.abort();
  }
  useEffect(() => {
    alive.current = true;
    const repository = createVideoDraftStore(scope);
    store.current = repository;
    const token = epoch.current,
      session = sessionGeneration();
    void repository
      .list()
      .then((rows) => {
        if (!current(token, session)) return;
        const files = rows.map((draft) => {
          entries.current.set(draft.id, {
            id: draft.id,
            draft,
            restored: true,
          });
          return {
            source: new File([draft.blob], draft.name, { type: 'video/mp4' }),
            options: { metadata: { draftId: draft.id } },
          };
        });
        setInitial(files);
        setInitialized(true);
      })
      .catch(() => {
        if (current(token, session)) {
          setWarning(m.videoNotRetained);
          setInitialized(true);
        }
      });
    const reset = () => {
      epoch.current++;
      stop();
      entries.current.clear();
      setInitial([]);
      setItems([]);
      setWarning('');
      setStage('');
      setInitialized(true);
      setResetKey((key) => key + 1);
      store.current = createVideoDraftStore(scope);
    };
    const sessionReset = () => {
      epoch.current++;
      stop();
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    const unsubscribe = subscribeLocalDataReset(reset);
    const unsubscribeSession = subscribeSessionReset(sessionReset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      epoch.current++;
      stop();
      unsubscribe();
      unsubscribeSession();
      document.removeEventListener('visibilitychange', hidden);
    };
    // Queue lifetime is the exercise/account scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  async function call(path: string, init: RequestInit) {
    const response = await apiFetch(`${base}${path}${query}`, {
      ...init,
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? m.forbidden
          : response.status === 409
            ? m.conflict
            : m.videoUploadError,
      );
    return (await response.json()).data as WorkoutVideo;
  }
  async function discard(entry: Entry) {
    const token = epoch.current,
      session = sessionGeneration();
    entry.controller?.abort();
    if (entry.draft?.uploadId)
      await call(`/${entry.draft.uploadId}`, { method: 'DELETE' });
    if (!current(token, session)) return false;
    await store.current?.remove(entry.id);
    if (!current(token, session)) return false;
    entries.current.delete(entry.id);
    void refresh().catch(() => {});
    return true;
  }
  const matched = new Set(
    [...entries.current.values()]
      .map((entry) => entry.draft?.uploadId)
      .filter(Boolean),
  );
  const unmatched = videos.filter(
    (row) => row.state === 'uploading' && !matched.has(row.id),
  );
  const ready = videos.filter((row) => row.state === 'ready').length;
  const pending = items.filter(
    (item) => !entries.current.get(item.getMetadata('draftId'))?.completed,
  ).length;
  const capacity = Math.max(pending, 8 - ready - unmatched.length);
  if (generation !== sessionGeneration()) return null;
  return (
    <Stack gap="xs" className={classes.queue}>
      {warning && (
        <Alert color="orange" role="alert">
          {warning}
        </Alert>
      )}
      <Text size="sm" c="dimmed">
        {m.videoQueueHelp}
      </Text>
      {initialized && (
        <FilePond
          key={resetKey}
          ref={pond}
          files={initial}
          allowMultiple
          instantUpload
          maxParallelUploads={1}
          maxFiles={capacity}
          allowBrowse={capacity > pending}
          allowDrop={capacity > pending}
          allowPaste={capacity > pending}
          allowRevert={false}
          allowProcess
          allowRemove
          name="videos"
          credits={false}
          labelIdle={m.videoQueueSelect}
          labelFileProcessing={m.videoUploading}
          labelFileProcessingComplete={m.videoUploaded}
          labelFileProcessingAborted={m.videoPaused}
          labelFileProcessingError={m.videoUploadError}
          labelTapToRetry={m.videoResume}
          labelTapToCancel={m.videoPause}
          labelTapToUndo=""
          labelButtonRemoveItem={m.videoDiscard}
          labelButtonAbortItemProcessing={m.videoPause}
          labelButtonRetryItemProcessing={m.videoResume}
          labelButtonProcessItem={m.videoResume}
          labelFileWaitingForSize={m.videoWaiting}
          labelFileSizeNotAvailable={m.videoWaiting}
          beforeAddFile={(item) => {
            if (!item.getMetadata('draftId'))
              item.setMetadata('draftId', crypto.randomUUID());
            return true;
          }}
          onupdatefiles={setItems}
          beforeRemoveFile={async (item) => {
            const entry = entries.current.get(item.getMetadata('draftId'));
            if (!entry) return true;
            if (entry.completed) {
              entries.current.delete(entry.id);
              return true;
            }
            try {
              return await discard(entry);
            } catch (cause) {
              setWarning(
                cause instanceof Error ? cause.message : m.videoUploadError,
              );
              return false;
            }
          }}
          onprocessfile={(error, item) => {
            if (!error) void pond.current?.removeFile(item.id);
          }}
          server={{
            process: (
              _field,
              file,
              metadata,
              load,
              fail,
              progress,
              aborted,
            ) => {
              const id =
                typeof metadata.draftId === 'string'
                  ? metadata.draftId
                  : crypto.randomUUID();
              metadata.draftId = id;
              // FilePond metadata is copied into the item; set explicitly for new selections.
              const item = pond.current
                ?.getFiles()
                .find((candidate) => candidate.file === file);
              item?.setMetadata('draftId', id);
              let entry = entries.current.get(id);
              if (!entry) {
                entry = { id };
                entries.current.set(id, entry);
              }
              if (entry.restored) {
                entry.restored = false;
                queueMicrotask(aborted);
                return { abort: aborted };
              }
              const active = entry;
              const controller = new AbortController();
              active.controller = controller;
              const token = epoch.current,
                session = sessionGeneration();
              const valid = () =>
                current(token, session) && !controller.signal.aborted;
              const check = () => {
                if (!valid()) throw new DOMException('Aborted', 'AbortError');
              };
              const persist = async (draft: VideoDraft) => {
                check();
                active.draft = draft;
                try {
                  await store.current?.save(draft);
                } catch {
                  if (valid()) setWarning(m.videoNotRetained);
                }
                check();
              };
              const task = async () => {
                try {
                  check();
                  if (!active.draft) {
                    setStage(`${file.name}: ${m.videoCompressing}`);
                    const compressed = await compressWorkoutVideo(
                      file as File,
                      controller.signal,
                      (n) => {
                        if (valid()) progress(true, n, 2);
                      },
                    );
                    check();
                    await persist({ ...compressed, id, name: file.name });
                  }
                  let draft = active.draft!;
                  await persist({
                    ...draft,
                    uploadId: draft.uploadId ?? crypto.randomUUID(),
                  });
                  draft = active.draft!;
                  setStage(`${file.name}: ${m.videoUploading}`);
                  const rows = await refresh(controller.signal);
                  check();
                  let row = rows.find((row) => row.id === draft.uploadId);
                  if (!row)
                    row = await call('', {
                      method: 'POST',
                      signal: controller.signal,
                      headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': draft.uploadId!,
                      },
                      body: JSON.stringify({
                        sessionId,
                        exerciseId,
                        size: draft.blob.size,
                        duration: draft.duration,
                      }),
                    });
                  check();
                  await persist({ ...draft, uploadId: row.id });
                  let acknowledged = row.parts.reduce(
                    (sum, part) =>
                      sum +
                      Math.min(
                        VIDEO_PART_BYTES,
                        draft.blob.size - part * VIDEO_PART_BYTES,
                      ),
                    0,
                  );
                  if (row.state !== 'ready')
                    for (
                      let part = 0;
                      part < Math.ceil(draft.blob.size / VIDEO_PART_BYTES);
                      part++
                    ) {
                      check();
                      if (row.parts.includes(part)) continue;
                      const blob = draft.blob.slice(
                        part * VIDEO_PART_BYTES,
                        (part + 1) * VIDEO_PART_BYTES,
                      );
                      await sendVideoPart(
                        `${base}/${row.id}/parts/${part}${query}`,
                        blob,
                        controller.signal,
                        (bytes) => {
                          if (valid())
                            progress(
                              true,
                              1 + (acknowledged + bytes) / draft.blob.size,
                              2,
                            );
                        },
                      );
                      check();
                      acknowledged += blob.size;
                    }
                  await call(`/${row.id}/finalize`, {
                    method: 'POST',
                    signal: controller.signal,
                  });
                  check();
                  await store.current?.remove(id).catch(() => {});
                  check();
                  active.completed = true;
                  await refresh(controller.signal).catch(() => {});
                  check();
                  load(row.id);
                } catch (cause) {
                  if (!current(token, session)) return;
                  if (controller.signal.aborted) aborted();
                  else
                    fail(
                      cause instanceof Error
                        ? cause.message
                        : m.videoUploadError,
                    );
                } finally {
                  if (active.controller === controller)
                    active.controller = undefined;
                  if (valid()) setStage('');
                }
              };
              serial.current = serial.current.then(task, task);
              return {
                abort: () => {
                  controller.abort();
                  aborted();
                },
              };
            },
          }}
        />
      )}
      <Text size="xs" c="dimmed">
        {m.videoLocalDraft}
      </Text>
      {stage && (
        <Text size="sm" aria-live="polite">
          {stage}
        </Text>
      )}
      {unmatched.map((row) => (
        <Group key={row.id}>
          <Text size="sm">{m.videoIncomplete}</Text>
          <Button
            mih={44}
            variant="subtle"
            color="red"
            onClick={() => {
              const entry = {
                id: row.id,
                draft: {
                  id: row.id,
                  name: '',
                  blob: new Blob(),
                  duration: 0,
                  uploadId: row.id,
                },
              };
              void discard(entry).catch(() => setWarning(m.videoUploadError));
            }}
          >
            {m.videoDiscard}
          </Button>
        </Group>
      ))}
    </Stack>
  );
}
