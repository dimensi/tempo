import 'server-only';
// Coordinated task explicitly permits the pure domain sub-entry from the server adapter.
// eslint-disable-next-line no-restricted-imports
import {
  normalizeDay,
  type Product,
  type Recipe,
} from '@/features/nutrition/domain';
import { meals } from '@/contracts/nutrition';
import { periodSchema, type SyncStatus } from '@/contracts/nutrition-sync';
import type { NutritionDayUpstream } from '@/server/yazio/adapter';
import type {
  NutritionRepository,
  PhotoRow,
} from '@/server/nutrition/repository';
import { fetchCdnImage, storeImage } from '@/server/nutrition/images';

export function periodDates(period: { from: string; to: string }) {
  const { from, to } = periodSchema.parse(period);
  const dates: string[] = [];
  for (let day = Date.parse(from); day <= Date.parse(to); day += 86400000)
    dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}
export async function boundedMap<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error('Invalid concurrency');
  const result: R[] = new Array(values.length);
  let next = 0;
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        result[index] = await task(values[index]!);
      }
    }),
  );
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return result;
}
// One supported Next.js process: one active sync per owner. Manual photos remain independent.
const active = new Set<string>();
export class NutritionSyncBusyError extends Error {}
export async function syncNutritionPeriod(
  ownerId: string,
  period: { from: string; to: string },
  upstream: NutritionDayUpstream,
  repository: NutritionRepository,
  images = { fetch: fetchCdnImage, store: storeImage },
  options?: { photoFailurePolicy: 'independent' },
) {
  const dates = periodDates(period);
  if (active.has(ownerId))
    throw new NutritionSyncBusyError('Sync already running');
  active.add(ownerId);
  const status: SyncStatus = {
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    completedDates: [],
    failedDates: [],
    photoFailedDates: [],
  };
  try {
    repository.saveStatus(ownerId, status);
    for (const date of dates) {
      try {
        let photoMetadataFailed = false;
        // Complete all upstream reads before replacing any part of the persisted day.
        const [items, summary, urls] = await Promise.all([
          upstream.items(date),
          upstream.summary(date),
          options?.photoFailurePolicy === 'independent'
            ? upstream
                .images(date)
                .catch((): Awaited<ReturnType<NutritionUpstream['images']>> => {
                  photoMetadataFailed = true;
                  return {};
                })
            : upstream.images(date),
        ]);
        const products: Record<string, Product | null> = {};
        const recipes: Record<string, Recipe | null> = {};
        const references = [
          ...[...new Set(items.products.map((i) => i.product_id))].map(
            (id) => ({ kind: 'product' as const, id }),
          ),
          ...[...new Set(items.recipe_portions.map((i) => i.recipe_id))].map(
            (id) => ({ kind: 'recipe' as const, id }),
          ),
        ];
        await boundedMap(references, 4, async ({ kind, id }) => {
          const cached = repository.cache(ownerId, kind, id);
          const value = cached
            ? cached.payload
            : await (kind === 'product'
                ? upstream.product(id)
                : upstream.recipe(id));
          if (!cached) repository.putCache(ownerId, kind, id, value);
          if (kind === 'product') products[id] = value as Product | null;
          else recipes[id] = value as Recipe | null;
        });
        const fetchedAt = new Date().toISOString();
        const day = normalizeDay({
          date,
          fetchedAt,
          items,
          summary,
          products,
          recipes,
        });
        let photoFailed = photoMetadataFailed;
        const photos = photoMetadataFailed
          ? repository
              .photos(ownerId, date)
              .filter((photo) => photo.source === 'yazio')
              .map((photo) => repository.photo(ownerId, photo.id))
              .filter((photo) => photo !== null)
          : await boundedMap(
              meals.filter((meal) => urls[meal]),
              2,
              async (daytime): Promise<PhotoRow | null> => {
                const sourceUrl = urls[daytime]!;
                const id = `${ownerId}:${date}:${daytime}:yazio`;
                try {
                  const { bytes, mime } = await images.fetch(sourceUrl);
                  const stored = await images.store(bytes, mime);
                  return {
                    id,
                    ownerId,
                    date,
                    daytime,
                    source: 'yazio' as const,
                    sourceUrl,
                    observedAt: fetchedAt,
                    mime,
                    ...stored,
                  };
                } catch {
                  photoFailed = true;
                  const existing = repository.photo(ownerId, id);
                  return existing?.source === 'yazio' ? existing : null;
                }
              },
            );
        // Range/scheduled sync retains its existing empty-snapshot protection.
        // A selected-day refresh trusts successfully fetched food independently
        // of media, including a confirmed empty day.
        const empty = day.meals.every((meal) => !meal.entries.length);
        const preserveSnapshot =
          options?.photoFailurePolicy !== 'independent' &&
          photoFailed &&
          empty &&
          Boolean(repository.day(ownerId, date));
        if (!preserveSnapshot) {
          repository.replaceDay(
            ownerId,
            day,
            photos.filter((photo): photo is PhotoRow => photo !== null),
          );
        }
        if (photoFailed) status.photoFailedDates.push(date);
        if (preserveSnapshot) status.failedDates.push(date);
        else status.completedDates.push(date);
      } catch {
        status.failedDates.push(date);
      }
      repository.saveStatus(ownerId, status);
    }
    status.state =
      status.failedDates.length || status.photoFailedDates.length
        ? status.completedDates.length
          ? 'partial'
          : 'failed'
        : 'completed';
    status.finishedAt = new Date().toISOString();
    repository.saveStatus(ownerId, status);
    return status;
  } finally {
    active.delete(ownerId);
  }
}
