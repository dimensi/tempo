import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const directories = process.argv.slice(2);
if (directories.length < 2)
  throw new Error(
    'Usage: node scripts/ci/compare-benchmarks.mjs <baseline-directory> <run-directory> [...]',
  );
const read = (directory, name) =>
  JSON.parse(readFileSync(`${directory}/${name}.json`, 'utf8'));
function cases(report) {
  const entries = [];
  function visit(suites) {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? [])
          entries.push({
            // Auth helper extraction moves line numbers, never scenario identity.
            key: JSON.stringify([spec.file, spec.title, test.projectName]),
            project: test.projectName,
            status: test.status,
          });
      }
      visit(suite.suites);
    }
  }
  visit(report.suites);
  entries.sort((a, b) => a.key.localeCompare(b.key));
  assert.equal(
    new Set(entries.map((entry) => entry.key)).size,
    entries.length,
    'Scenario keys must be unique',
  );
  assert.ok(entries.length > 0);
  assert.equal(report.stats.unexpected, 0, 'No failed cases');
  assert.equal(report.stats.flaky, 0, 'No flaky cases');
  return entries;
}
const baseline = read(directories[0], 'evidence');
const baselineCases = new Map(
  baseline.families.map(({ family }) => [
    family,
    cases(read(directories[0], family)),
  ]),
);
const baselineSeconds = baseline.families.reduce(
  (sum, family) => sum + family.seconds,
  0,
);
const comparisons = [];
for (const directory of directories.slice(1)) {
  const evidence = read(directory, 'evidence');
  assert.equal(
    evidence.revision,
    baseline.revision,
    'Application Git SHA must match',
  );
  assert.equal(
    evidence.buildId,
    baseline.buildId,
    'Use the identical prebuilt production artifact',
  );
  assert.deepEqual(
    evidence.families.map((entry) => entry.family),
    baseline.families.map((entry) => entry.family),
  );
  const families = evidence.families.map((family) => {
    assert.equal(family.error, undefined);
    const actual = cases(read(directory, family.family));
    assert.deepEqual(
      actual,
      baselineCases.get(family.family),
      'Exact case/viewports/status conservation',
    );
    const viewports = Object.fromEntries(
      [...new Set(actual.map((entry) => entry.project))].map((project) => [
        project,
        {
          selected: actual.filter((entry) => entry.project === project).length,
          skipped: actual.filter(
            (entry) => entry.project === project && entry.status === 'skipped',
          ).length,
        },
      ]),
    );
    return {
      ...family,
      viewports,
      coverageSha256: createHash('sha256')
        .update(JSON.stringify(actual))
        .digest('hex'),
    };
  });
  const seconds = families.reduce((sum, family) => sum + family.seconds, 0);
  comparisons.push({
    directory,
    workers: evidence.concurrency,
    seconds,
    speedup: baselineSeconds / seconds,
    families,
  });
}
console.log(
  JSON.stringify(
    {
      revision: baseline.revision,
      buildId: baseline.buildId,
      baselineSeconds,
      comparisons,
    },
    null,
    2,
  ),
);
