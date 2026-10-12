import 'server-only';
import type { TransformMateClient } from './client';
import type { TransformMateExerciseDetail } from './types';
import { TransformMateApiError } from './errors';
import { MAX_RETRY_AFTER_MS } from './retry-after';
import type { z } from 'zod';
import type { transformMateCatalogSchema } from './catalog-schema';

type Catalog = z.infer<typeof transformMateCatalogSchema>;
export type CatalogScope = {
  ownerId: string;
  generation: string;
  locale: 'ru';
  client: TransformMateClient;
};
type Entry = {
  client: TransformMateClient;
  catalog?: Catalog;
  expires: number;
  pending?: Promise<Catalog>;
  cooldown: number;
  aliases: Map<number, string[]>;
};
const entries = new Map<string, Entry>();
const TTL_MS = 5 * 60_000;
const MAX_SCOPES = 32;
function key(scope: CatalogScope) {
  return JSON.stringify([scope.ownerId, scope.generation, scope.locale]);
}
export function invalidateTransformMateCatalog(ownerId: string) {
  for (const scope of entries.keys())
    if ((JSON.parse(scope) as string[])[0] === ownerId) entries.delete(scope);
}
function entryFor(scope: CatalogScope): Entry {
  const scopeKey = key(scope);
  let entry = entries.get(scopeKey);
  if (!entry || entry.client !== scope.client) {
    // A binding change discards old generations, aliases and cooldowns.
    for (const other of entries.keys())
      if (
        (JSON.parse(other) as string[])[0] === scope.ownerId &&
        other !== scopeKey
      )
        entries.delete(other);
    entry = {
      client: scope.client,
      expires: 0,
      cooldown: 0,
      aliases: new Map(),
    };
    entries.set(scopeKey, entry);
  }
  entries.delete(scopeKey);
  entries.set(scopeKey, entry);
  while (entries.size > MAX_SCOPES)
    entries.delete(entries.keys().next().value!);
  return entry;
}
export async function cachedCatalog(scope: CatalogScope): Promise<Catalog> {
  const entry = entryFor(scope);
  const now = Date.now();
  if (entry.catalog && entry.expires > now) return entry.catalog;
  if (entry.pending) return entry.pending;
  if (entry.cooldown > now)
    throw new TransformMateApiError({
      status: 429,
      statusText: '',
      contentType: '',
      isJson: false,
      body: null,
      retryAfterMs: entry.cooldown - now,
    });
  const operation = scope.client
    .listExercises()
    .then(({ body }) => {
      entry.catalog = body;
      entry.expires = Date.now() + TTL_MS;
      entry.cooldown = 0;
      entry.aliases.clear();
      return body;
    })
    .catch((error: unknown) => {
      if (error instanceof TransformMateApiError && error.status === 429)
        entry.cooldown =
          Date.now() +
          Math.min(
            MAX_RETRY_AFTER_MS,
            Math.max(1_000, error.retryAfterMs ?? 5_000),
          );
      throw error;
    })
    .finally(() => {
      if (entry.pending === operation) entry.pending = undefined;
    });
  entry.pending = operation;
  return operation;
}
export function rememberExerciseAliases(
  scope: CatalogScope,
  detail: TransformMateExerciseDetail,
) {
  const entry = entryFor(scope);
  // Store only bounded search terms from a requested detail, never URLs or media.
  if (entry.aliases.size >= 1_000 && !entry.aliases.has(detail.id))
    entry.aliases.delete(entry.aliases.keys().next().value!);
  entry.aliases.set(
    detail.id,
    detail.other_names
      .slice(0, 50)
      .map((name) => name.slice(0, 500).toLocaleLowerCase(scope.locale)),
  );
}
export function catalogMatches(
  scope: CatalogScope,
  id: number,
  name: string,
  query: string,
) {
  return (
    !query ||
    name.toLocaleLowerCase(scope.locale).includes(query) ||
    (entryFor(scope).aliases.get(id) ?? []).some((alias) =>
      alias.includes(query),
    )
  );
}
