import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const limits = { unit: 3, integration: 8, e2e: 2, total: 14 };
const run = (args) =>
  execFileSync('pnpm', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

const vitest = run(['exec', 'vitest', 'list', '--config', 'vitest.config.ts'])
  .trim()
  .split('\n')
  .filter(Boolean);
const counts = {
  unit: vitest.filter((line) => line.startsWith('tests/unit/')).length,
  integration: vitest.filter((line) => line.startsWith('tests/integration/'))
    .length,
};
if (counts.unit + counts.integration !== vitest.length)
  throw new Error('Vitest discovery found a case outside unit or integration');

const browserCases = (config) => {
  const report = JSON.parse(
    run([
      'exec',
      'playwright',
      'test',
      '--list',
      '--reporter=json',
      '--config',
      config,
    ]),
  );
  const count = (suites) =>
    (suites ?? []).reduce(
      (total, suite) =>
        total +
        (suite.specs ?? []).reduce(
          (sum, spec) => sum + (spec.tests ?? []).length,
          0,
        ) +
        count(suite.suites),
      0,
    );
  return count(report.suites);
};
counts.e2e =
  browserCases('playwright.config.ts') +
  browserCases('tests/nutrition-sync/e2e.config.ts');
counts.total = counts.unit + counts.integration + counts.e2e;

const over = Object.entries(limits).filter(
  ([name, limit]) => counts[name] > limit,
);
const result = { counts, limits, status: over.length ? 'failed' : 'passed' };
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/test-budget.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (over.length)
  throw new Error(
    `Test budget exceeded: ${over.map(([name]) => name).join(', ')}`,
  );
