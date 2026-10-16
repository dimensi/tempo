import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const limits = { unit: 3, integration: 8, e2e: 2, total: 14 };
const run = (args) =>
  execFileSync('pnpm', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
const vitestCases = run([
  'exec',
  'vitest',
  'list',
  '--config',
  'vitest.config.ts',
])
  .trim()
  .split('\n')
  .filter(Boolean);
const collectPlaywrightCases = (suites) =>
  (suites ?? []).flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      (spec.tests ?? []).map((test) => ({
        id: spec.id,
        project: test.projectName,
        file: spec.file,
        title: spec.title,
      })),
    ),
    ...collectPlaywrightCases(suite.suites),
  ]);
const browserCases = (config) =>
  collectPlaywrightCases(
    JSON.parse(
      run([
        'exec',
        'playwright',
        'test',
        '--list',
        '--reporter=json',
        '--config',
        config,
      ]),
    ).suites,
  );

const cases = {
  unit: vitestCases.filter((line) => line.startsWith('tests/unit/')),
  integration: vitestCases.filter((line) =>
    line.startsWith('tests/integration/'),
  ),
  e2e: {
    smoke: browserCases('playwright.config.ts'),
    nutrition: browserCases('tests/nutrition-sync/e2e.config.ts'),
  },
};
if (cases.unit.length + cases.integration.length !== vitestCases.length)
  throw new Error('Vitest discovery found a case outside unit or integration');
const counts = {
  unit: cases.unit.length,
  integration: cases.integration.length,
  e2e: cases.e2e.smoke.length + cases.e2e.nutrition.length,
};
counts.total = counts.unit + counts.integration + counts.e2e;

const over = Object.entries(limits).filter(
  ([name, limit]) => counts[name] > limit,
);
const result = {
  cases,
  counts,
  limits,
  status: over.length ? 'failed' : 'passed',
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/test-budget.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (over.length)
  throw new Error(
    `Test budget exceeded: ${over.map(([name]) => name).join(', ')}`,
  );
