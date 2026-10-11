import 'server-only';
import { open } from 'node:fs/promises';
import {
  nutritionDaySchema,
  safeMealPhotoViewSchema,
} from '@/contracts/nutrition';
import {
  reportLimits,
  reportRequestSchema,
  periodDates,
  type ReportRequest,
} from '@/contracts/reports';
import { ReportError } from '@/server/pdf/errors';
import { type ReportDataSource, type ReportDataset } from '@/server/pdf/source';
import { renderReportHtml } from '@/server/pdf/template';
import { renderPdf } from '@/server/pdf/renderer';
import { photoPixels } from '@/server/pdf/images';

let active = false;
export async function withReportSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (active) throw new ReportError('BUSY', 429);
  active = true;
  try {
    return await operation();
  } finally {
    active = false;
  }
}
export async function readReportFont(): Promise<Uint8Array> {
  const path =
    process.env.PDF_FONT_PATH ??
    (process.platform === 'darwin'
      ? '/System/Library/Fonts/Supplemental/Arial.ttf'
      : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  try {
    // Operator-provided system font; never trace worktree files into standalone.
    const file = await open(/* turbopackIgnore: true */ path, 'r');
    try {
      if ((await file.stat()).size > 2 * 1024 * 1024)
        throw new Error('Font too large');
      return await file.readFile();
    } finally {
      await file.close();
    }
  } catch {
    throw new ReportError('RUNTIME', 503);
  }
}
function validateBudget(days: unknown[]) {
  // Bound serialized strings/decimal precision before passing data to Zod or Chromium.
  const json = JSON.stringify(days);
  if (Buffer.byteLength(json) > 8 * 1024 * 1024)
    throw new ReportError('OVERSIZED', 413);
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 12) throw new ReportError('INVALID', 422);
    if (typeof value === 'string' && value.length > 1500)
      throw new ReportError('OVERSIZED', 413);
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else if (value && typeof value === 'object')
      Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(days);
}
export async function loadReportDataset(
  source: ReportDataSource,
  request: ReportRequest,
  signal: AbortSignal,
): Promise<ReportDataset> {
  const dates = periodDates(request.start, request.end);
  const rawDays = await source.getNutritionDays(
    request.ownerId,
    request.start,
    request.end,
    signal,
  );
  if (rawDays.length > dates.length) throw new ReportError('INVALID', 422);
  validateBudget(rawDays);
  const days = rawDays.map((day) => nutritionDaySchema.parse(day));
  let entries = 0;
  for (const day of days) {
    for (const totals of [day.totals, day.knownTotals]) {
      for (const value of Object.values(totals)) {
        if (
          value !== null &&
          (value.length > 80 ||
            Math.abs(Number(value.split(/e/i)[1] ?? 0)) > 100)
        )
          throw new ReportError('OVERSIZED', 413);
      }
    }
    entries += day.meals.reduce(
      (count, meal) => count + meal.entries.length,
      0,
    );
  }
  if (entries > reportLimits.entries) throw new ReportError('OVERSIZED', 413);
  if (
    new Set(days.map((day) => day.date)).size !== days.length ||
    days.some((day) => !dates.includes(day.date))
  )
    throw new ReportError('INVALID', 422);
  const metadata = await source.listPhotos(
    request.ownerId,
    request.start,
    request.end,
    signal,
  );
  if (metadata.length > reportLimits.photos)
    throw new ReportError('OVERSIZED', 413);
  const photos: ReportDataset['photos'] = [];
  let bytesTotal = 0;
  let pixelsTotal = 0;
  const ids = new Set<string>();
  for (const raw of metadata) {
    signal.throwIfAborted();
    const photo = safeMealPhotoViewSchema.parse(raw);
    if (!dates.includes(photo.date) || ids.has(photo.id))
      throw new ReportError('INVALID', 422);
    ids.add(photo.id);
    const file = await source.readPhoto(request.ownerId, photo.id, signal);
    bytesTotal += file.bytes.byteLength;
    if (
      file.bytes.byteLength > reportLimits.photoBytes ||
      bytesTotal > reportLimits.totalPhotoBytes
    )
      throw new ReportError('OVERSIZED', 413);
    const bytes = Buffer.from(file.bytes);
    const valid =
      (file.mime === 'image/png' &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (file.mime === 'image/jpeg' &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255) ||
      (file.mime === 'image/webp' &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP');
    if (!valid) throw new ReportError('INVALID', 422);
    pixelsTotal += photoPixels(bytes, file.mime);
    if (pixelsTotal > 32_000_000) throw new ReportError('OVERSIZED', 413);
    photos.push({
      ...photo,
      dataUri: `data:${file.mime};base64,${bytes.toString('base64')}`,
    });
  }
  if (!days.length && !photos.length) throw new ReportError('NO_DATA', 404);
  return { days, photos };
}
export async function generateReport(
  source: ReportDataSource,
  input: ReportRequest,
  signal: AbortSignal,
) {
  const request = reportRequestSchema.parse(input);
  const dataset = await loadReportDataset(source, request, signal);
  signal.throwIfAborted();
  const html = renderReportHtml(request, dataset, await readReportFont());
  if (Buffer.byteLength(html) > reportLimits.htmlBytes)
    throw new ReportError('OVERSIZED', 413);
  return request.format === 'html' ? html : await renderPdf(html);
}
