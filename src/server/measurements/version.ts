import 'server-only';
import { measurementInputSchema } from '@/contracts/measurements';
import { writeFingerprint } from '@/server/write-receipts';
export const measurementVersion = (value: {
  measuredAt: string;
  values: unknown;
  note: string | null;
}) =>
  writeFingerprint(
    measurementInputSchema.parse({
      measuredAt: value.measuredAt,
      values: value.values,
      note: value.note,
    }),
  );
