import { expect, it } from 'vitest';
import { reconcileRead } from '@/lib/reconcile-read';
it('keeps equal records and replaces only changed records', () => {
  const previous = {
    rows: [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ],
  };
  const next = reconcileRead(previous, {
    rows: [
      { id: 'a', value: 1 },
      { id: 'b', value: 3 },
    ],
  });
  expect(next).not.toBe(previous);
  expect(next.rows[0]).toBe(previous.rows[0]);
  expect(next.rows[1]).not.toBe(previous.rows[1]);
  expect(reconcileRead(next, structuredClone(next))).toBe(next);
});
it('preserves real removals, null and zero', () => {
  expect(reconcileRead({ a: 1, b: 2 }, { a: 0 })).toEqual({ a: 0 });
  expect(reconcileRead([1, 2], [0])).toEqual([0]);
  expect(reconcileRead(1, null)).toBeNull();
});
