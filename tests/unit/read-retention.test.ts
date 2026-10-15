import { expect, it } from 'vitest';
import {
  pruneReadRecords,
  readResponseSchema,
  type ReadRecord,
} from '@/contracts/read-resources';
const now = Date.parse('2026-10-15T12:00:00Z');
const row = (key: string, touchedAt = now): ReadRecord => ({
  version: 1,
  key,
  body: '{}',
  savedAt: now - 1000,
  touchedAt,
});
it('retains viewed historical medical detail by visit time, not the date of the analysis', () => {
  const saved = row('/api/anamnesis/markers/old/observations?from=2001-01-01');
  expect(pruneReadRecords([saved], now)).toEqual([saved]);
  expect(
    pruneReadRecords([{ ...saved, touchedAt: now - 15 * 86400000 }], now),
  ).toEqual([]);
});
it('evicts least recently viewed detail under row and byte limits without evicting medical summaries', () => {
  const detail = Array.from({ length: 110 }, (_, i) =>
    row(`/api/anamnesis/markers/m${i}`, now - i),
  );
  const result = pruneReadRecords(
    [row('/api/anamnesis/markers'), ...detail],
    now,
  );
  expect(result).toHaveLength(101);
  expect(result.some((r) => r.key.endsWith('m109'))).toBe(false);
  const large = {
    ...row('/api/anamnesis/documents/a'),
    body: 'x'.repeat(6 * 1024 * 1024),
  };
  expect(
    pruneReadRecords(
      [
        large,
        { ...large, key: '/api/anamnesis/documents/b', touchedAt: now - 1 },
      ],
      now,
    ),
  ).toEqual([large]);
});
it('does not put credentials, raw providers, import diagnostics or file responses on disk', () => {
  for (const path of [
    '/api/auth/get-session',
    '/api/yazio/status',
    '/api/transformmate/status',
    '/api/anamnesis/imports',
    '/api/anamnesis/documents/id/file',
  ])
    expect(readResponseSchema(path)).toBeUndefined();
  const parsed = readResponseSchema('/api/settings/steps-goal')!.safeParse({
    dailyStepsGoal: 10000,
    refreshToken: 'never-store',
  });
  expect(parsed.success).toBe(false);
});
