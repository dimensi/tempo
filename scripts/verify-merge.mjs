import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

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

function stopProcessTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* The process group may already be gone. */
  }
}

function run(command, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', [command], {
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    });
    let timedOut = false;
    let escalation;
    const timeout = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child, 'SIGTERM');
      escalation = setTimeout(() => stopProcessTree(child, 'SIGKILL'), 2000);
    }, timeoutSeconds * 1000);
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(escalation);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (status, signal) => {
      cleanup();
      resolve({ status: status ?? 1, signal, timedOut });
    });
  });
}

function assertExactExecution(label, discovered, executed) {
  const expected = [...discovered].sort();
  const actual = [...executed].sort();
  if (
    expected.length === actual.length &&
    expected.every((identity, index) => identity === actual[index])
  )
    return;
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const preview = (values) => values.slice(0, 3).join(', ') || 'none';
  const missing = expected.filter((identity) => !actualSet.has(identity));
  const unexpected = actual.filter((identity) => !expectedSet.has(identity));
  throw new Error(
    `${label} execution does not match discovery (missing: ${preview(missing)}; unexpected: ${preview(unexpected)})`,
  );
}

function verifyVitestExecution(label, discovered, reportFile) {
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const tests = (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((assertion) => ({
      identity: `${relative(process.cwd(), file.name).split(sep).join('/')} > ${[...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(' > ')}`,
      status: assertion.status,
    })),
  );
  assertExactExecution(
    label,
    discovered,
    tests.map((test) => test.identity),
  );
  if (!report.success || tests.some((test) => test.status !== 'passed'))
    throw new Error(`${label} contains a skipped, failed, or incomplete case`);
  return { discovered: discovered.length, executed: tests.length };
}

function collectPlaywrightTests(suites) {
  return (suites ?? []).flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      (spec.tests ?? []).map((test) => ({
        id: spec.id,
        project: test.projectName,
        results: test.results ?? [],
      })),
    ),
    ...collectPlaywrightTests(suite.suites),
  ]);
}

function verifyPlaywrightExecution(label, discovered, reportFile) {
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const tests = collectPlaywrightTests(report.suites);
  const identity = (test) => `${test.id}:${test.project}`;
  assertExactExecution(label, discovered.map(identity), tests.map(identity));
  if (
    tests.some(
      (test) =>
        test.results.length !== 1 ||
        test.results[0]?.status !== 'passed' ||
        test.results[0]?.retry !== 0,
    )
  )
    throw new Error(`${label} contains a skipped, retried, or incomplete case`);
  return { discovered: discovered.length, executed: tests.length };
}

function verifyTestExecution(cases) {
  return {
    unit: verifyVitestExecution('unit', cases.unit, 'test-results/unit.json'),
    integration: verifyVitestExecution(
      'integration',
      cases.integration,
      'test-results/integration.json',
    ),
    e2e: {
      smoke: verifyPlaywrightExecution(
        'smoke E2E',
        cases.e2e.smoke,
        'test-results/smoke.json',
      ),
      nutrition: verifyPlaywrightExecution(
        'nutrition E2E',
        cases.e2e.nutrition,
        'test-results/nutrition.json',
      ),
    },
  };
}

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
    const remaining = timeBudget.total - (performance.now() - started) / 1000;
    const timeoutSeconds = Math.min(timeBudget[command] ?? Infinity, remaining);
    if (timeoutSeconds <= 0)
      throw new Error(
        `pnpm verify:merge exceeded its ${timeBudget.total}s time budget`,
      );
    const begin = performance.now();
    const result = await run(command, timeoutSeconds);
    const check = {
      command: `pnpm ${command}`,
      seconds: Number(((performance.now() - begin) / 1000).toFixed(3)),
      status: result.status,
      timeoutSeconds: Number(timeoutSeconds.toFixed(3)),
      timedOut: result.timedOut,
      signal: result.signal,
    };
    evidence.checks.push(check);
    save();
    if (result.timedOut)
      throw new Error(`${check.command} exceeded its time budget`);
    if (result.status !== 0)
      throw new Error(`${check.command} failed; merge is blocked`);
  }
  evidence.buildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
  evidence.testBudget = JSON.parse(
    readFileSync('test-results/test-budget.json', 'utf8'),
  );
  evidence.execution = verifyTestExecution(evidence.testBudget.cases);
  save();
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
