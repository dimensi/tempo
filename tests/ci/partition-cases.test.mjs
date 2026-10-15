import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionCases } from '../../scripts/ci/partition-cases.mjs';
import { summarizeResets } from '../../scripts/ci/reset-statistics.mjs';
const cases = ['desktop', 'mobile'].flatMap((project) =>
  Array.from({ length: 13 }, (_, line) => ({
    file: 'suite.spec.ts',
    line,
    title: `scenario ${line}`,
    project,
  })),
);
for (const concurrency of [1, 2, 3, 4]) {
  test(`${concurrency} workers partition both viewports with exact scenario conservation`, () => {
    const groups = partitionCases(cases, concurrency);
    assert.equal(groups.length, concurrency);
    assert.deepEqual(
      groups.flat().map(JSON.stringify).sort(),
      cases.map(JSON.stringify).sort(),
    );
    for (const group of groups) {
      assert.deepEqual(
        [...new Set(group.map((entry) => entry.project))],
        ['desktop', 'mobile'],
      );
      assert.equal(
        group.filter((entry) => entry.project === 'desktop').length,
        group.length / 2,
      );
    }
    assert.ok(
      Math.max(...groups.map((group) => group.length)) -
        Math.min(...groups.map((group) => group.length)) <=
        2,
    );
  });
}
test('empty and small selections never create empty workers', () => {
  assert.deepEqual(partitionCases([], 4), []);
  assert.equal(partitionCases(cases.slice(0, 1), 4).length, 1);
});
test('reset quantiles use nearest rank without silently coercing invalid samples', () => {
  const samples = Array.from({ length: 20 }, (_, index) =>
    Object.fromEntries(
      ['stop', 'sqlite', 'filesystem', 'next', 'start', 'total'].map(
        (phase) => [phase, index + 1],
      ),
    ),
  );
  assert.deepEqual(summarizeResets(samples).milliseconds.total, {
    p50: 10,
    p95: 19,
    sum: 210,
  });
  assert.equal(summarizeResets([]).milliseconds.total.p50, null);
  assert.throws(() => summarizeResets([{ total: NaN }]));
});
