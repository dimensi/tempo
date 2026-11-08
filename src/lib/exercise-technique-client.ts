import { techniqueEditorSchema } from '@/contracts/exercise-technique';
import { apiFetch } from './api-client';
import { sessionGeneration } from './session-state';

export class TechniqueRequestError extends Error {
  constructor(readonly status: number) {
    super();
  }
}

export const techniqueEditorHref = (ownerId: string, id: number, path = '') =>
  `/api/workouts/transformmate/exercises/${id}/technique${path}?ownerId=${encodeURIComponent(ownerId)}`;

export async function requestExerciseTechnique(
  href: string,
  scope: string,
  init: RequestInit,
) {
  const generation = sessionGeneration();
  init.signal?.throwIfAborted();
  const response = await apiFetch(href, { ...init, cache: 'no-store' });
  if (!response.ok) throw new TechniqueRequestError(response.status);
  const next = techniqueEditorSchema.parse((await response.json()).data);
  if (generation !== sessionGeneration() || init.signal?.aborted)
    throw new DOMException('', 'AbortError');
  if (next.scope !== scope) throw new TechniqueRequestError(409);
  return next;
}
