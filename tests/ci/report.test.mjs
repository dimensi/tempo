import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requireCompleteReport,
  requirePassingReport,
} from '../../scripts/ci/report.mjs';

test('merge gate rejects omissions, skips, failures, retries and revision-incomplete reports', () => {
  const entry = {
    file: 'e2e/example.spec.ts',
    line: 1,
    title: 'example',
    project: 'desktop',
  };
  const report = {
    stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    isolation: {
      selectedCases: [entry],
      cases: [{ ...entry, status: 'expected' }],
      errors: [],
    },
    suites: [{ specs: [{ tests: [{ results: [{ status: 'passed' }] }] }] }],
  };
  assert.doesNotThrow(() => requireCompleteReport(report));
  for (const field of ['skipped', 'flaky', 'unexpected']) {
    const broken = structuredClone(report);
    broken.stats[field] = 1;
    assert.throws(() => requireCompleteReport(broken));
  }
  for (const mutate of [
    (r) => {
      r.isolation.cases = [];
    },
    (r) => {
      r.isolation.selectedCases.push(entry);
    },
    (r) => {
      r.isolation.cases[0].project = 'mobile';
    },
    (r) => {
      r.isolation.errors.push({ message: 'reset failed' });
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results.push({ status: 'passed' });
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = 'skipped';
    },
  ]) {
    const broken = structuredClone(report);
    mutate(broken);
    assert.throws(() => requireCompleteReport(broken));
  }
});
test('selected coverage cannot go green from empty, failed, omitted or skipped area cases', () => {
  for (const stats of [
    { expected: 0, unexpected: 0 },
    { expected: 1, unexpected: 1 },
  ])
    assert.throws(() => requirePassingReport({ stats }));
  assert.throws(() =>
    requirePassingReport(
      { stats: { expected: 1, unexpected: 0 }, suites: [] },
      ['diary'],
    ),
  );
  const report = {
    stats: { expected: 1, unexpected: 0 },
    suites: [
      {
        specs: [
          { title: 'diary', tests: [{ results: [{ status: 'skipped' }] }] },
        ],
      },
    ],
  };
  assert.throws(() => requirePassingReport(report, ['diary']));
  report.suites[0].specs[0].tests[0].results[0].status = 'passed';
  assert.equal(requirePassingReport(report, ['diary']).expected, 1);
  assert.equal(
    requirePassingReport({ numPassedTests: 1, numFailedTests: 0 }).expected,
    1,
  );
});
test('explicit desktop-only requirement keeps legacy mobile skip without accepting a skipped or missing desktop', () => {
  const report = {
    stats: { expected: 1, unexpected: 0 },
    suites: [
      {
        specs: [
          {
            title: 'held install',
            tests: [
              { projectName: 'desktop', results: [{ status: 'passed' }] },
              { projectName: 'mobile', results: [{ status: 'skipped' }] },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(
    requirePassingReport(report, [
      { pattern: 'held install', project: 'desktop' },
    ]).expected,
    1,
  );
  assert.throws(() => requirePassingReport(report, ['held install']));
  report.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.throws(() =>
    requirePassingReport(report, [
      { pattern: 'held install', project: 'desktop' },
    ]),
  );
  report.suites[0].specs[0].tests.shift();
  assert.throws(() =>
    requirePassingReport(report, [
      { pattern: 'held install', project: 'desktop' },
    ]),
  );
});
