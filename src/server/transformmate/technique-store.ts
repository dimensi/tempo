import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import {
  exerciseTechniqueDescriptions as descriptions,
  exerciseTechniqueVideos as videos,
} from '@/server/db/schema/exercise-technique';
import { catalogStore, type CatalogIdentity } from './catalog-store';

export type TechniqueTarget = Omit<CatalogIdentity, 'locale'> & {
  exerciseId: number;
};
export type TechniqueVideo = typeof videos.$inferSelect;
export const candidateStates = ['uploading', 'processing', 'failed'] as const;
export const db = () => getDatabase().db;

export function techniqueScopeToken(target: TechniqueTarget) {
  return createHash('sha256')
    .update(
      JSON.stringify([target.ownerId, target.accountScope, target.exerciseId]),
    )
    .digest('hex');
}

export function ownsTechnique(target: TechniqueTarget) {
  return (
    catalogStore().record({ ...target, locale: 'ru' }, target.exerciseId)
      ?.detail?.ownedCustom === true
  );
}

export function descriptionTarget(target: TechniqueTarget) {
  return and(
    eq(descriptions.ownerId, target.ownerId),
    eq(descriptions.accountScope, target.accountScope),
    eq(descriptions.exerciseId, target.exerciseId),
  );
}

export function videoTarget(target: TechniqueTarget) {
  return and(
    eq(videos.ownerId, target.ownerId),
    eq(videos.accountScope, target.accountScope),
    eq(videos.exerciseId, target.exerciseId),
  );
}

export function techniqueContent(target: TechniqueTarget) {
  const description = db()
    .select()
    .from(descriptions)
    .where(descriptionTarget(target))
    .get();
  const videoId =
    db()
      .select({ id: videos.id })
      .from(videos)
      .where(and(videoTarget(target), eq(videos.state, 'ready')))
      .get()?.id ?? null;
  return {
    scope: techniqueScopeToken(target),
    revision: description?.revision ?? 0,
    description: description?.description ?? '',
    videoId,
  };
}

export function techniqueCandidate(target: TechniqueTarget) {
  return db()
    .select()
    .from(videos)
    .where(and(videoTarget(target), inArray(videos.state, candidateStates)))
    .get();
}

export function techniqueEditorData(target: TechniqueTarget) {
  const row = techniqueCandidate(target);
  return {
    ...techniqueContent(target),
    candidate:
      row && row.state !== 'ready' && row.state !== 'retired'
        ? {
            id: row.id,
            name: row.name,
            size: row.size,
            lastModified: row.lastModified,
            parts: Object.keys(row.parts).map(Number),
            state: row.state,
            progress: row.progress,
            error: row.error,
          }
        : null,
  };
}
