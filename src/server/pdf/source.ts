import 'server-only';
import type { NutritionDay, SafeMealPhotoView } from '@/contracts/nutrition';
import type { ReportRequest } from '@/contracts/reports';
import { ReportError } from '@/server/pdf/errors';

export interface ReportDataSource {
  // Implementations must enforce limits before materializing data, accept abort,
  // and read private bytes by owner/id; never fetch sourceUrl in the renderer.
  getNutritionDays(
    ownerId: string,
    start: string,
    end: string,
    signal: AbortSignal,
  ): Promise<NutritionDay[]>;
  listPhotos(
    ownerId: string,
    start: string,
    end: string,
    signal: AbortSignal,
  ): Promise<SafeMealPhotoView[]>;
  readPhoto(
    ownerId: string,
    photoId: string,
    signal: AbortSignal,
  ): Promise<{
    bytes: Uint8Array;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
  }>;
}
export type ReportDataset = {
  days: NutritionDay[];
  photos: Array<SafeMealPhotoView & { dataUri: string }>;
};
// Composition seam for source C. No silent demo fallback or global test setter.
export function reportDataSource(): ReportDataSource {
  throw new ReportError('UNAVAILABLE', 503);
}
export type ReportScope = Pick<ReportRequest, 'ownerId' | 'start' | 'end'>;

// Exact source C public interface. Coordinator connects its server entry below
// once C is merged; the renderer never receives headers or private locators.
export interface NutritionReportApi {
  listNutritionDays(
    headers: Headers,
    ownerId: string,
    period: { from: string; to: string },
  ): Promise<NutritionDay[]>;
  listMealPhotos(
    headers: Headers,
    ownerId: string,
    period: { from: string; to: string },
  ): Promise<SafeMealPhotoView[]>;
  readMealPhoto(
    headers: Headers,
    ownerId: string,
    photoId: string,
  ): Promise<{ bytes: Buffer; contentType: string }>;
}
export function createNutritionReportSource(
  headers: Headers,
  api: NutritionReportApi,
): ReportDataSource {
  return {
    async getNutritionDays(ownerId, start, end, signal) {
      signal.throwIfAborted();
      const days = await api.listNutritionDays(headers, ownerId, {
        from: start,
        to: end,
      });
      signal.throwIfAborted();
      return days;
    },
    async listPhotos(ownerId, start, end, signal) {
      signal.throwIfAborted();
      const photos = await api.listMealPhotos(headers, ownerId, {
        from: start,
        to: end,
      });
      signal.throwIfAborted();
      return photos;
    },
    async readPhoto(ownerId, photoId, signal) {
      signal.throwIfAborted();
      const photo = await api.readMealPhoto(headers, ownerId, photoId);
      signal.throwIfAborted();
      if (
        photo.contentType !== 'image/jpeg' &&
        photo.contentType !== 'image/png' &&
        photo.contentType !== 'image/webp'
      )
        throw new ReportError('INVALID', 422);
      return { bytes: photo.bytes, mime: photo.contentType };
    },
  };
}
