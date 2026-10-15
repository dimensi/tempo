import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';

export const reportLimits = {
  days: 31,
  entries: 3000,
  photos: 60,
  photoBytes: 8 * 1024 * 1024,
  totalPhotoBytes: 20 * 1024 * 1024,
  htmlBytes: 40 * 1024 * 1024,
} as const;
export const reportRequestSchema = z
  .object({
    contractVersion: z.literal(1).default(1),
    ownerId: z.string().min(1).max(128),
    period: z.enum(['daily', 'weekly', 'custom']),
    start: diaryDateSchema,
    end: diaryDateSchema,
    format: z.enum(['html', 'pdf']),
  })
  .strict()
  .superRefine((request, context) => {
    const days = periodDates(request.start, request.end).length;
    if (
      days < 1 ||
      days > reportLimits.days ||
      (request.period === 'daily' && days !== 1) ||
      (request.period === 'weekly' && days !== 7)
    )
      context.addIssue({ code: 'custom', message: 'Invalid report period' });
  });
export type ReportRequest = z.infer<typeof reportRequestSchema>;
// Inclusive UTC calendar arithmetic; no timezone conversion of diary dates.
export function periodDates(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  const count = (last - first) / 86400000 + 1;
  if (!Number.isInteger(count) || count < 1 || count > reportLimits.days)
    return [];
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * 86400000).toISOString().slice(0, 10),
  );
}

export type ReportDataset = {
  days: import('./nutrition').NutritionDay[];
  steps: import('./health').StepsSummary['days'];
  photos: Array<
    import('./nutrition').SafeMealPhotoView & { dataUri: string | null }
  >;
};
export type ReportFonts = {
  sans: Uint8Array;
  bold: Uint8Array;
  serif: Uint8Array;
};
