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
import type { DayWork } from '@/server/yazio/sync-progress';
import { syncReadFailure } from '@/server/yazio/sync-diagnostics';

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
  options?: {
    work?: ReadonlyMap<string, DayWork>;
    force?: boolean;
    beforePhotos?: () => Promise<void>;
    onFoodSettled?: (date: string) => void;
    onPhotosSettled?: (date: string) => void;
  },
) {
  const dates = options?.work ? [...options.work.keys()] : periodDates(period);
  if (active.has(ownerId))
    throw new NutritionSyncBusyError('Sync already running');
  active.add(ownerId);
  const status: SyncStatus = {
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    completedDates: [],
    skippedDates: [],
    failedDates: [],
    photoFailedDates: [],
  };
  try {
    repository.saveStatus(ownerId, status);
    for (const date of dates) {
      if (options?.work?.get(date)?.food === false) {
        status.skippedDates.push(date);
        continue;
      }
      const started = Date.now();
      let stage = 'food';
      try {
        const [items, summary] = await Promise.all([
          upstream.items(date),
          upstream.summary(date),
        ]);
        const products: Record<string, Product | null> = {};
        const recipes: Record<string, Recipe | null> = {};
        const references = [
          ...[...new Set(items.products.map((item) => item.product_id))].map(
            (id) => ({ kind: 'product' as const, id }),
          ),
          ...[
            ...new Set(items.recipe_portions.map((item) => item.recipe_id)),
          ].map((id) => ({ kind: 'recipe' as const, id })),
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
        stage = 'persist-food';
        repository.saveDay(
          ownerId,
          normalizeDay({
            date,
            fetchedAt: new Date().toISOString(),
            items,
            summary,
            products,
            recipes,
          }),
        );
        status.completedDates.push(date);
      } catch (error) {
        syncReadFailure(stage, date, started, error);
        status.failedDates.push(date);
      }
      repository.saveStatus(ownerId, status);
      options?.onFoodSettled?.(date);
    }
    await options?.beforePhotos?.();
    for (const date of dates) {
      const work = options?.work?.get(date);
      if (work?.photos === false) continue;
      const started = Date.now();
      let stage = 'photo-metadata';
      try {
        const urls = await upstream.images(date);
        stage = 'persist-photos';
        let failed = false;
        const photos = await boundedMap(
          meals.filter((meal) => urls[meal]),
          2,
          async (daytime): Promise<PhotoRow | null> => {
            const sourceUrl = urls[daytime]!;
            const id = `${ownerId}:${date}:${daytime}:yazio`;
            const existing = repository.photo(ownerId, id);
            try {
              // Historical repair can reuse the same source. Recent and forced
              // refreshes fetch it again because the bytes may have changed.
              if (
                !options?.force &&
                work?.food === false &&
                existing?.sourceUrl === sourceUrl
              )
                return existing;
              const { bytes, mime } = await images.fetch(sourceUrl);
              return {
                id,
                ownerId,
                date,
                daytime,
                source: 'yazio',
                sourceUrl,
                observedAt: new Date().toISOString(),
                mime,
                ...(await images.store(bytes, mime)),
              };
            } catch (error) {
              syncReadFailure('photo-download', date, started, error);
              failed = true;
              return existing?.source === 'yazio' ? existing : null;
            }
          },
        );
        repository.replaceYazioPhotos(
          ownerId,
          date,
          photos.filter((photo): photo is PhotoRow => photo !== null),
          !failed,
        );
        if (failed) status.photoFailedDates.push(date);
      } catch (error) {
        syncReadFailure(stage, date, started, error);
        status.photoFailedDates.push(date);
      }
      repository.saveStatus(ownerId, status);
      options?.onPhotosSettled?.(date);
    }
    status.state =
      status.failedDates.length || status.photoFailedDates.length
        ? status.completedDates.length || status.skippedDates.length
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
