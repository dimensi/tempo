import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

if (process.argv.length !== 2) throw new Error('Usage: pnpm verify:merge');
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
      'Another merge verification holds the lock. Wait for its owner before removing a stale lock.',
    );
  throw error;
}

const evidence = {
  revision: git('rev-parse', 'HEAD'),
  status: 'running',
  checks: [],
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
const timeBudget = {
  'test:unit': 30,
  'test:integration': 60,
  'test:e2e': 90,
  total: 300,
};

try {
  save();
  for (const command of [
    'format:check',
    'lint',
    'typecheck',
    'test:budget',
    'test:unit',
    'test:integration',
    'build',
    'test:e2e',
  ]) {
    unchanged();
    const begin = performance.now();
    const result = spawnSync('pnpm', [command], { stdio: 'inherit' });
    const check = {
      command: `pnpm ${command}`,
      seconds: Number(((performance.now() - begin) / 1000).toFixed(3)),
      status: result.status ?? 1,
    };
    evidence.checks.push(check);
    save();
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${check.command} failed; merge is blocked`);
    const limit = timeBudget[command];
    if (limit && check.seconds > limit)
      throw new Error(`${check.command} exceeded its ${limit}s time budget`);
  }
  evidence.buildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
  evidence.testBudget = JSON.parse(
    readFileSync('test-results/test-budget.json', 'utf8'),
  );
  unchanged();
  if ((performance.now() - started) / 1000 > timeBudget.total)
    throw new Error(
      `pnpm verify:merge exceeded its ${timeBudget.total}s time budget`,
    );
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  evidence.seconds = Number(((performance.now() - started) / 1000).toFixed(3));
  save();
  rmSync(lock, { recursive: true, force: true });
}

console.log(JSON.stringify(evidence, null, 2));
