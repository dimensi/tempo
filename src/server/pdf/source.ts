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
