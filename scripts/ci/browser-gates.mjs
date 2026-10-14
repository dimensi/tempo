import { spawnSync, execFileSync } from 'node:child_process';
import {
  readFileSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { requirePassingReport } from './report.mjs';
import { isolatedBrowser } from './isolated-browser.mjs';
import { browserPlan } from './browser-plan.mjs';
const selection = JSON.parse(
  readFileSync('test-results/ci-selection.json', 'utf8'),
);
const runs = browserPlan(selection);
const evidence = {
  ...selection,
  browserArtifactBuilds: 1,
  buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  productionStarts: 0,
  families: [],
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/production-starts.jsonl', '');
for (const run of runs) {
  const start = performance.now();
  rmSync(`test-results/${run.family}.json`, { force: true });
  const args = run.vitest
    ? ['exec', 'vitest', 'run', '--config', run.config]
    : [
        'exec',
        'playwright',
        'test',
        '--config',
        run.config,
        ...(run.grep ? ['--grep', run.grep] : []),
      ];
  let result;
  if (run.isolated) {
    try {
      await isolatedBrowser(run, Number(process.env.CI_E2E_CONCURRENCY ?? 2));
      result = { status: 0 };
    } catch (error) {
      console.error(error);
      result = { status: 1 };
    }
  } else result = spawnSync('pnpm', args, { stdio: 'inherit' });
  evidence.productionStarts = readFileSync(
    'test-results/production-starts.jsonl',
    'utf8',
  )
    .trim()
    .split('\n')
    .filter(Boolean).length;
  if (readFileSync('.next/BUILD_ID', 'utf8').trim() !== evidence.buildId)
    throw new Error('Browser artifact changed between families');
  let stats;
  let reportError;
  try {
    const report = JSON.parse(
      readFileSync(`test-results/${run.family}.json`, 'utf8'),
    );
    stats = requirePassingReport(report, run.requiredCases);
  } catch (error) {
    reportError = error.message;
    /* Preserve the failure, never infer tests passed. */
  }
  evidence.families.push({
    family: run.family,
    seconds: Number(((performance.now() - start) / 1000).toFixed(2)),
    exitCode: result.status,
    stats,
    reportError,
  });
  writeFileSync(
    'test-results/ci-browser-evidence.json',
    JSON.stringify(evidence, null, 2),
  );
  if (
    result.status !== 0 ||
    !stats ||
    stats.expected < 1 ||
    stats.unexpected > 0
  )
    process.exit(result.status || 1);
}
const summary = `Production browser gates: ${JSON.stringify(evidence, null, 2)}\nDocker builds/tests its separate release image; browser families reuse one prebuilt artifact.\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    '```json\n' +
      JSON.stringify(evidence, null, 2) +
      '\n```\nDocker release-image build is separate.\n',
  );
