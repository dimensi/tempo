'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkoutVideo } from '@/contracts/workout-videos';
import { apiFetch } from '@/lib/api-client';
import { subscribeSessionReset } from '@/lib/offline-device';
import { sessionGeneration } from '@/lib/session-state';

// One lookup for the workout, independent of the number of exercise rows.
export function useUploadedVideos(ownerId: string, sessionId?: string) {
  const scope = `${ownerId}:${sessionId}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    generation: number;
    ids: Set<string>;
  }>();
  const revision = useRef(0);
  const changes = useRef(new Map<string, boolean>());
  useEffect(() => {
    if (!sessionId) return;
    const abort = new AbortController();
    changes.current.clear();
    const load = async () => {
      const token = ++revision.current;
      const generation = sessionGeneration();
      try {
        const response = await apiFetch(
          `/api/workouts/videos?ownerId=${encodeURIComponent(ownerId)}&sessionId=${encodeURIComponent(sessionId)}`,
          { signal: abort.signal, cache: 'no-store' },
        );
        if (!response.ok) return;
        const rows: WorkoutVideo[] = (await response.json()).data;
        if (
          abort.signal.aborted ||
          token !== revision.current ||
          generation !== sessionGeneration()
        )
          return;
        const ids = new Set(
          rows
            .filter((row) => row.state !== 'uploading')
            .map((row) => row.exerciseId),
        );
        for (const [id, present] of changes.current) {
          if (present) ids.add(id);
          else ids.delete(id);
        }
        setSnapshot({ scope, generation, ids });
      } catch {
        // The media dialog retains its own visible load error and upload controls.
      }
    };
    void load();
    const stop = subscribeSessionReset(() => {
      changes.current.clear();
      setSnapshot(undefined);
      void load();
    });
    return () => {
      abort.abort();
      stop();
    };
  }, [ownerId, sessionId, scope]);
  const update = useCallback(
    (exerciseId: string, hasVideos: boolean) => {
      changes.current.set(exerciseId, hasVideos);
      setSnapshot((previous) => {
        const generation = sessionGeneration();
        const ids = new Set(
          previous?.scope === scope && previous.generation === generation
            ? previous.ids
            : [],
        );
        if (hasVideos) ids.add(exerciseId);
        else ids.delete(exerciseId);
        return { scope, generation, ids };
      });
    },
    [scope],
  );
  return {
    ids:
      snapshot?.scope === scope && snapshot.generation === sessionGeneration()
        ? snapshot.ids
        : new Set<string>(),
    update,
  };
}
