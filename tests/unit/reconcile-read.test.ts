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

it('keeps stable records across insertions and reordering', () => {
  const previous = [
    { id: 'a', value: 1 },
    { id: 'b', value: 2 },
  ];
  const next = reconcileRead(previous, [
    { id: 'c', value: 3 },
    { id: 'b', value: 2 },
    { id: 'a', value: 1 },
  ]);
  expect(next[1]).toBe(previous[1]);
  expect(next[2]).toBe(previous[0]);
});
