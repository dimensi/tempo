import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isolatedBrowser } from './ci/isolated-browser.mjs';
import { runProcessGroup } from './ci/process-group.mjs';
import { requireCompleteReport } from './ci/report.mjs';

const workers = Number(process.argv[2] ?? 4);
if (process.argv.length > 3 || ![1, 2, 3, 4].includes(workers))
  throw new Error('Usage: pnpm verify:merge [1..4 workers]; default 4');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain'))
  throw new Error(
    'Commit the final revision before verify:merge; working tree must be clean',
  );
mkdirSync('test-results', { recursive: true });
const lock = 'test-results/merge-verification.lock';
try {
  mkdirSync(lock);
} catch (error) {
  if (error.code === 'EEXIST')
    throw new Error(
      'Another merge verification holds the lock. Do not run concurrently; inspect ownership before removing a stale lock.',
    );
  throw error;
}
const evidence = {
  revision: git('rev-parse', 'HEAD'),
  workers,
  status: 'running',
  checks: [],
  suites: [],
};
const save = () =>
  writeFileSync(
    'test-results/merge-verification.json',
    JSON.stringify(evidence, null, 2),
  );
const unchanged = () => {
  if (
    git('rev-parse', 'HEAD') !== evidence.revision ||
    git('status', '--porcelain')
  )
    throw new Error(
      'Revision changed during verification; rerun on the final committed revision',
    );
};
const started = performance.now();
const controller = new AbortController();
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
try {
  save();
  for (const check of [
    'format:check',
    'lint',
    'typecheck',
    'test',
    'test:ci:selection',
    'build',
  ]) {
    unchanged();
    const status = await runProcessGroup('pnpm', [check], {
      cwd: process.cwd(),
      env: process.env,
      signal: controller.signal,
    });
    evidence.checks.push({ command: `pnpm ${check}`, status });
    save();
    if (status !== 0) throw new Error(`pnpm ${check} failed; merge is blocked`);
  }
  evidence.buildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
  for (const run of [
    { family: 'general', config: 'playwright.config.ts' },
    { family: 'nutrition', config: 'tests/nutrition-sync/e2e.config.ts' },
    {
      family: 'transformmate',
      config: 'tests/transformmate-sync/e2e.config.ts',
    },
  ]) {
    if (controller.signal.aborted)
      throw new Error('Merge verification cancelled');
    unchanged();
    const begin = performance.now();
    const report = await isolatedBrowser(run, workers);
    requireCompleteReport(report);
    if (readFileSync('.next/BUILD_ID', 'utf8').trim() !== evidence.buildId)
      throw new Error('Build changed during E2E verification');
    evidence.suites.push({
      ...run,
      stats: report.stats,
      selected: report.isolation.selectedCases.length,
      seconds: (performance.now() - begin) / 1000,
    });
    save();
  }
  if (controller.signal.aborted)
    throw new Error('Merge verification cancelled');
  unchanged();
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
  evidence.seconds = (performance.now() - started) / 1000;
  save();
  rmSync(lock, { recursive: true });
}
console.log(JSON.stringify(evidence, null, 2));
