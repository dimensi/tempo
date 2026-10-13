import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirePassingReport } from '../../scripts/ci/report.mjs';
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
