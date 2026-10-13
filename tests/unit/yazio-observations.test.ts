import { expect, it } from 'vitest';
import {
  canonicalYazioBodyValue,
  sameYazioBodyValue,
  yazioObservationDate,
} from '@/lib/yazio-observations';

it.each([
  [103.30000305175781, '103.3'],
  [103.5999984741211, '103.6'],
  [Math.fround(70.125), '70.125'],
])('projects only exact float32 roundtrips %s', (raw, expected) => {
  expect(canonicalYazioBodyValue(raw)).toBe(expected);
  expect(canonicalYazioBodyValue(String(raw))).toBe(expected);
  expect(sameYazioBodyValue(raw, expected)).toBe(true);
  expect(sameYazioBodyValue(expected, raw)).toBe(true);
});
it.each([
  80.12345,
  Math.fround(80.12345),
  '103.3000030517578100000000001',
  -1,
  0,
  NaN,
  Infinity,
  10000,
  '9999.9991',
  '1e2',
  '70,2',
  ' 70',
  '',
  'invalid',
  0.0001,
])('does not normalize true precision or invalid/range value %s', (value) => {
  expect(canonicalYazioBodyValue(value)).toBeNull();
});
it('preserves exact values, rejects false sync equality and leaves the manual precision contract separate', () => {
  expect(canonicalYazioBodyValue('9999.999')).toBe('9999.999');
  expect(canonicalYazioBodyValue('103.300')).toBe('103.3');
  expect(sameYazioBodyValue(80.12345, '80.123')).toBe(false);
  expect(sameYazioBodyValue(80.12345, '80.12345')).toBe(true);
  expect(
    sameYazioBodyValue('103.3000030517578100000000001', 103.30000305175781),
  ).toBe(false);
  expect(sameYazioBodyValue(-1, -1)).toBe(false);
});
it.each(['2026-10-07', '2026-10-07 10:55:43', '2024-02-29 23:59:59'])(
  'reads the validated provider calendar date %s',
  (value) => {
    expect(yazioObservationDate(value)).toBe(value.slice(0, 10));
  },
);
it.each([
  '2026-02-29',
  '2026-02-30 10:00:00',
  '1900-02-29 10:00:00',
  '2026-13-01 00:00:00',
  '2026-10-07 24:00:00',
  '2026-10-07 10:60:00',
  '2026-10-07 10:00:60',
  '2026-10-07T10:55:43Z',
  '2026-10-07 10:55:43+03:00',
  '2026-10-07 10:55',
  '07/10/2026',
  '2026-10-07 10:55:43.1',
  '2026-10-07 1:55:43',
])('rejects overflow/unknown provider time semantics %s', (value) => {
  expect(yazioObservationDate(value)).toBeNull();
});
