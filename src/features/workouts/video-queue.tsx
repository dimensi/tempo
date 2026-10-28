'use client';
import {
  VIDEO_PART_BYTES,
  VIDEO_INPUT_MAX_BYTES,
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
import { find, type ActualFileObject, type FilePondFile } from 'filepond';
import FilePondPluginFileValidateType from 'filepond-plugin-file-validate-type';
import { FilePond, registerPlugin } from 'react-filepond';
import { useEffect, useRef, useState } from 'react';
import 'filepond/dist/filepond.min.css';
import { workoutMessages as m } from './messages';
import { sendVideoPart } from './video-upload';
import classes from './video-queue.module.css';
registerPlugin(FilePondPluginFileValidateType);
function videoError(cause: unknown) {
  const known: string[] = [
    m.forbidden,
    m.conflict,
    m.videoInputLimit,
    m.videoLoadError,
  ];
  return cause instanceof Error && known.includes(cause.message)
    ? cause.message
    : m.videoUploadError;
}
type Entry = {
  id: string;
  epoch: number;
  session: number;
  draft?: VideoDraft;
  restored?: boolean;
  completed?: boolean;
  retained?: boolean;
  paused?: boolean;
  controller?: AbortController;
};
export default function VideoQueue({
  ownerId,
  sessionId,
  exerciseId,
  videos,
  refresh,
  onUploaded,
  onRemoved,
}: {
  ownerId: string;
  sessionId: string;
  exerciseId: string;
  videos: WorkoutVideo[];
  refresh: (signal?: AbortSignal) => Promise<WorkoutVideo[]>;
  onUploaded: (video: WorkoutVideo) => void;
  onRemoved: (id: string) => void;
}) {
  const pond = useRef<FilePond>(null);
  const entries = useRef(new Map<string, Entry>());
  const restoredIds = useRef(new WeakMap<Blob, string>());
  const store = useRef<ReturnType<typeof createVideoDraftStore> | null>(null);
  const epoch = useRef(0);
  const serial = useRef<Promise<void>>(Promise.resolve());
  const [initialized, setInitialized] = useState(false);
  const [stage, setStage] = useState('');
  const [fileErrors, setFileErrors] = useState<
    Record<
      string,
      {
        name: string;
        message: string;
      }
    >
  >({});
  const alive = useRef(false);
  const [reselect, setReselect] = useState<VideoDraft[]>([]);
  const [initial, setInitial] = useState<ActualFileObject[]>([]);
  const [items, setItems] = useState<FilePondFile[]>([]);
  const [draftUploads, setDraftUploads] = useState<
    Record<string, string | undefined>
  >({});
  const [warning, setWarning] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [reinserting, setReinserting] = useState(false);
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
        setReselect(rows.filter((draft) => !draft.blob));
        const files = rows.flatMap((draft) => {
          entries.current.set(draft.id, {
            id: draft.id,
            epoch: token,
            session,
            draft,
            restored: true,
            retained: true,
          });
          if (!draft.blob) return [];
          const file = new File([draft.blob], draft.name, {
            type: 'video/mp4',
          });
          restoredIds.current.set(file, draft.id);
          return [file];
        });
        setInitial(files);
        setDraftUploads(
          Object.fromEntries(rows.map((draft) => [draft.id, draft.uploadId])),
        );
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
      setReselect([]);
      setItems([]);
      setDraftUploads({});
      setWarning('');
      setStage('');
      setFileErrors({});
      setReinserting(false);
      setInitialized(true);
      setResetKey((key) => key + 1);
      store.current = createVideoDraftStore(scope);
    };
    const sessionReset = () => {
      stop();
    };
    const unsubscribe = subscribeLocalDataReset(reset);
    const unsubscribeSession = subscribeSessionReset(sessionReset);
    const cleanup = () => {
      alive.current = false;
      epoch.current++;
      stop();
      unsubscribe();
      unsubscribeSession();
    };
    return cleanup;
    // Queue lifetime is the exercise/account scope.
  }, [scope]);
  useEffect(() => {
    const readyIds = new Set(
      videos
        .filter(
          (row) =>
            row.state === 'ready' ||
            row.state === 'processing' ||
            row.state === 'failed',
        )
        .map((row) => row.id),
    );
    const token = epoch.current,
      session = sessionGeneration();
    for (const entry of entries.current.values()) {
      if (
        !entry.draft?.uploadId ||
        entry.completed ||
        !readyIds.has(entry.draft.uploadId)
      )
        continue;
      // A lost finalize response must not leave another retryable upload.
      entry.completed = true;
      entry.controller?.abort();
      void store.current
        ?.remove(entry.id)
        .catch(() => {
          if (current(token, session)) setWarning(m.videoNotRetained);
        })
        .then(() => {
          if (!current(token, session)) return;
          setReselect((rows) => rows.filter((row) => row.id !== entry.id));
          const item = items.find(
            (item) => item.getMetadata('draftId') === entry.id,
          );
          if (item) void pond.current?.removeFile(item.id);
          else {
            entries.current.delete(entry.id);
            forgetUpload(entry.id);
          }
        });
    }
  }, [videos, items, reselect]);
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
    if (entry.draft?.uploadId) {
      const response = await apiFetch(
        `${base}/${entry.draft.uploadId}${query}`,
        { method: 'DELETE' },
      );
      if (!response.ok && response.status !== 404)
        throw new Error(
          response.status === 403 ? m.forbidden : m.videoUploadError,
        );
    }
    if (!current(token, session)) return false;
    if (entry.retained) await store.current?.remove(entry.id);
    if (!current(token, session)) return false;
    entries.current.delete(entry.id);
    forgetUpload(entry.id);
    if (entry.draft?.uploadId) onRemoved(entry.draft.uploadId);
    void refresh().catch(() => {});
    return true;
  }
  function forgetUpload(id: string) {
    setDraftUploads((uploads) => {
      const next = { ...uploads };
      delete next[id];
      return next;
    });
  }
  const matched = new Set(Object.values(draftUploads).filter(Boolean));
  const unmatched = videos.filter(
    (row) => row.state === 'uploading' && !matched.has(row.id),
  );
  const serverOnly = videos.filter((row) => !matched.has(row.id)).length;
  const capacity = Math.max(items.length, 8 - serverOnly);
  if (generation !== sessionGeneration()) return null;
  return (
    <Stack gap="xs" className={classes.queue}>
      {warning && (
        <Alert color="orange" role="alert">
          {warning}
        </Alert>
      )}
      <Text size="sm">{m.videoLimits}</Text>
      {initialized && (
        <FilePond
          key={resetKey}
          ref={pond}
          oninit={() => {
            const token = epoch.current,
              session = sessionGeneration();
            if (initial.length)
              void pond.current?.addFiles(initial).catch(() => {
                if (current(token, session)) setWarning(m.videoInvalidFiles);
              });
          }}
          allowMultiple
          acceptedFileTypes={['video/*']}
          fileValidateTypeDetectType={(file, type) =>
            Promise.resolve(
              type ||
                (/\.(mp4|m4v)$/i.test(file.name)
                  ? 'video/mp4'
                  : /\.mov$/i.test(file.name)
                    ? 'video/quicktime'
                    : type),
            )
          }
          labelFileTypeNotAllowed={m.videoExpectedType}
          fileValidateTypeLabelExpectedTypes={m.videoExpectedType}
          instantUpload
          maxParallelUploads={1}
          maxFiles={capacity}
          allowBrowse={!reinserting && capacity > items.length}
          allowDrop={!reinserting && capacity > items.length}
          allowPaste={!reinserting && capacity > items.length}
          allowRevert={false}
          allowProcess
          allowRemove
          name="videos"
          credits={false}
          labelIdle={m.videoQueueSelect}
          labelFileProcessing={stage || m.videoPreparing}
          labelFileProcessingComplete={m.videoUploaded}
          labelFileProcessingAborted={m.videoPausedShort}
          labelFileProcessingError={m.videoFailedShort}
          labelInvalidField={m.videoInvalidFiles}
          labelFileLoading={m.videoWaiting}
          labelFileLoadError={m.videoLoadError}
          labelFileRemoveError={m.videoUploadError}
          labelFileProcessingRevertError={m.videoUploadError}
          labelButtonAbortItemLoad={m.videoPause}
          labelButtonRetryItemLoad={m.videoResume}
          labelButtonUndoItemProcessing={m.videoDiscard}
          labelTapToRetry={m.videoRetryShort}
          labelTapToCancel={m.videoPauseShort}
          labelTapToUndo=""
          labelButtonRemoveItem={m.videoDiscard}
          labelButtonAbortItemProcessing={m.videoPause}
          labelButtonRetryItemProcessing={m.videoResume}
          labelButtonProcessItem={m.videoResume}
          labelFileWaitingForSize={m.videoWaiting}
          labelFileSizeNotAvailable={m.videoWaiting}
          labelFileSizeBytes={m.videoBytes}
          labelFileSizeKilobytes={m.videoKilobytes}
          labelFileSizeMegabytes={m.videoMegabytes}
          labelFileSizeGigabytes={m.videoGigabytes}
          beforeAddFile={(item) => {
            if (item.file.size > VIDEO_INPUT_MAX_BYTES) {
              setWarning(m.videoInputLimit);
              return false;
            }
            const original = item.file as File;
            const draft = reselect.find(
              (candidate) =>
                candidate.name === original.name &&
                candidate.size === original.size &&
                candidate.lastModified === original.lastModified,
            );
            if (
              !draft &&
              !restoredIds.current.has(item.file) &&
              items.length + reselect.length + serverOnly >= 8
            ) {
              setWarning(m.videoQueueLimit);
              return false;
            }
            if (draft) {
              item.setMetadata('draftId', draft.id);
              const entry = entries.current.get(draft.id);
              if (entry) entry.restored = false;
              setReselect((rows) => rows.filter((row) => row.id !== draft.id));
            }
            if (!item.getMetadata('draftId'))
              item.setMetadata(
                'draftId',
                restoredIds.current.get(item.file) ?? crypto.randomUUID(),
              );
            return true;
          }}
          onupdatefiles={setItems}
          onremovefile={(error, item) => {
            const entry = entries.current.get(item.getMetadata('draftId'));
            if (
              error ||
              !entry?.paused ||
              entry.completed ||
              !current(entry.epoch, entry.session)
            )
              return;
            const token = entry.epoch,
              session = entry.session;
            // Instant-upload FilePond removes a cancelled item. Keep our resumable
            // recording visible by restoring it as an explicitly paused entry.
            const file = entry.draft?.blob
              ? new File([entry.draft.blob], entry.draft.name, {
                  type: 'video/mp4',
                })
              : item.file;
            restoredIds.current.set(file, entry.id);
            entry.restored = true;
            entry.paused = false;
            setReinserting(true);
            void pond.current
              ?.addFile(file)
              .catch(() => {
                if (current(token, session)) setWarning(m.videoInvalidFiles);
              })
              .finally(() => {
                if (current(token, session)) setReinserting(false);
              });
          }}
          beforeRemoveFile={async (item) => {
            const token = epoch.current,
              session = sessionGeneration();
            const entry = entries.current.get(item.getMetadata('draftId'));
            if (!entry) return true;
            if (entry.completed) {
              entries.current.delete(entry.id);
              forgetUpload(entry.id);
              return true;
            }
            try {
              const removed = await discard(entry);
              if (removed && current(token, session))
                setFileErrors((errors) => {
                  const next = { ...errors };
                  delete next[entry.id];
                  return next;
                });
              return removed;
            } catch (cause) {
              if (current(token, session)) setWarning(videoError(cause));
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
                entry = {
                  id,
                  epoch: epoch.current,
                  session: sessionGeneration(),
                };
                entries.current.set(id, entry);
              }
              let paused = false;
              const pause = () => {
                if (paused) return;
                paused = true;
                aborted();
              };
              if (entry.restored) {
                entry.restored = false;
                queueMicrotask(pause);
                const restored = entry;
                return {
                  abort: () => {
                    restored.paused = true;
                    pause();
                  },
                };
              }
              const active = entry;
              setFileErrors((errors) => {
                const next = { ...errors };
                delete next[id];
                return next;
              });
              active.paused = false;
              const controller = new AbortController();
              active.controller = controller;
              const token = epoch.current,
                session = sessionGeneration();
              const valid = () =>
                current(token, session) && !controller.signal.aborted;
              const check = () => {
                if (!valid()) throw new DOMException('Aborted', 'AbortError');
              };
              const phase = (label: string) => {
                check();
                setStage(label);
                const element = pond.current?.element;
                if (element)
                  find(element)?.setOptions({ labelFileProcessing: label });
                progress(true, 0, 1);
              };
              const persist = async (draft: VideoDraft) => {
                check();
                active.draft = draft;
                setDraftUploads((uploads) => ({
                  ...uploads,
                  [id]: draft.uploadId,
                }));
                try {
                  await store.current?.save(draft);
                  active.retained = true;
                } catch {
                  if (valid()) setWarning(m.videoNotRetained);
                }
                check();
              };
              const task = async () => {
                try {
                  check();
                  if (!active.draft) {
                    await persist({
                      id,
                      name: file.name,
                      size: file.size,
                      lastModified: (file as File).lastModified,
                    });
                  }
                  const source = active.draft!.blob ?? file;
                  let draft = active.draft!;
                  await persist({
                    ...draft,
                    uploadId: draft.uploadId ?? crypto.randomUUID(),
                  });
                  draft = active.draft!;
                  phase(m.videoUploading);
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
                        size: source.size,
                        name: draft.name.slice(0, 240),
                        lastModified: draft.lastModified,
                      }),
                    });
                  check();
                  await persist({ ...draft, uploadId: row.id });
                  let acknowledged = row.parts.reduce(
                    (sum, part) =>
                      sum +
                      Math.min(
                        VIDEO_PART_BYTES,
                        source.size - part * VIDEO_PART_BYTES,
                      ),
                    0,
                  );
                  if (row.state === 'uploading')
                    for (
                      let part = 0;
                      part < Math.ceil(source.size / VIDEO_PART_BYTES);
                      part++
                    ) {
                      check();
                      if (row.parts.includes(part)) continue;
                      const blob = source.slice(
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
                              (acknowledged + bytes) / source.size,
                              1,
                            );
                        },
                      );
                      check();
                      acknowledged += blob.size;
                    }
                  const saved =
                    row.state === 'ready' || row.state === 'processing'
                      ? row
                      : await call(`/${row.id}/finalize`, {
                          method: 'POST',
                          signal: controller.signal,
                        });
                  check();
                  await store.current?.remove(id).catch(() => {});
                  check();
                  active.completed = true;
                  onUploaded(saved);
                  await refresh(controller.signal).catch(() => {});
                  check();
                  load(row.id);
                } catch (cause) {
                  if (!current(token, session)) return;
                  if (
                    controller.signal.aborted ||
                    (cause instanceof DOMException &&
                      cause.name === 'AbortError')
                  )
                    pause();
                  else {
                    const message = videoError(cause);
                    setFileErrors((errors) => ({
                      ...errors,
                      [id]: {
                        name: file.name,
                        message,
                      },
                    }));
                    fail(message);
                  }
                } finally {
                  if (active.controller === controller)
                    active.controller = undefined;
                  if (current(token, session)) setStage('');
                }
              };
              serial.current = serial.current.then(task, task);
              return {
                abort: () => {
                  active.paused = true;
                  controller.abort();
                  pause();
                },
              };
            },
          }}
        />
      )}
      {Object.entries(fileErrors).map(([id, error]) => (
        <Alert key={id} color="red" role="alert" className={classes.error}>
          <Text fw={600} className={classes.filename}>
            {error.name}
          </Text>
          <Text mt={4}>{error.message}</Text>
        </Alert>
      ))}
      <details className={classes.help}>
        <summary>{m.videoHelpTitle}</summary>
        <Stack gap="xs" pt="xs">
          <Text size="sm">{m.videoQueueHelp}</Text>
          <Text size="sm">{m.videoHelp}</Text>
          <Text size="sm">{m.videoLocalDraft}</Text>
        </Stack>
      </details>
      {reselect.map((draft) => (
        <Group key={draft.id}>
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
            {draft.name}: {m.videoReselect}
          </Text>
          <Button
            variant="subtle"
            color="red"
            mih={44}
            onClick={() => {
              const token = epoch.current,
                session = sessionGeneration();
              const entry = entries.current.get(draft.id);
              if (entry)
                void discard(entry)
                  .then((removed) => {
                    if (removed && current(token, session))
                      setReselect((rows) =>
                        rows.filter((row) => row.id !== draft.id),
                      );
                  })
                  .catch(() => {
                    if (current(token, session)) setWarning(m.videoUploadError);
                  });
            }}
          >
            {m.videoDiscard}
          </Button>
        </Group>
      ))}
      {unmatched.map((row) => (
        <Group key={row.id}>
          <Text size="sm">
            {row.name}: {m.videoIncomplete}
          </Text>
          <Button
            mih={44}
            variant="subtle"
            color="red"
            onClick={() => {
              const token = epoch.current,
                session = sessionGeneration();
              const entry = {
                id: row.id,
                epoch: token,
                session,
                draft: {
                  id: row.id,
                  name: '',
                  size: row.size,
                  uploadId: row.id,
                },
              };
              void discard(entry).catch(() => {
                if (current(token, session)) setWarning(m.videoUploadError);
              });
            }}
          >
            {m.videoDiscard}
          </Button>
        </Group>
      ))}
    </Stack>
  );
}
