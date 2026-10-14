import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { requirePassingReport } from './report.mjs';
import { runProcessGroup } from './process-group.mjs';

// One disposable checkout and browser process per bounded worker. Each case
// restores its closed synthetic fixture and private paths before a fresh Next
// process starts; real memory auth quotas are never bypassed or reset in-place.
export async function isolatedBrowser(run, concurrency = 2) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    return await executeIsolated(run, concurrency, controller.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
async function executeIsolated(run, concurrency, signal) {
  if (![1, 2].includes(concurrency))
    throw new Error('Browser concurrency must be 1 or 2');
  mkdirSync('test-results', { recursive: true });
  const listed = JSON.parse(
    execFileSync(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--config',
        run.config,
        ...(run.files ?? []),
        ...(run.grep ? ['--grep', run.grep] : []),
        ...(run.grepInvert ? ['--grep-invert', run.grepInvert] : []),
        '--list',
        '--reporter=json',
      ],
      { encoding: 'utf8' },
    ),
  );
  if (listed.errors?.length) throw new Error(JSON.stringify(listed.errors));
  const cases = [];
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? [])
          cases.push({
            id: spec.id,
            file: spec.file,
            line: spec.line,
            title: spec.title,
            project: test.projectName,
          });
      }
      visit(suite.suites);
    }
  };
  visit(listed.suites);
  if (!cases.length) throw new Error('Isolation selection is empty');
  for (const pattern of run.files ?? []) {
    if (!cases.some((entry) => new RegExp(pattern).test(entry.file)))
      throw new Error(`Selected file pattern has no cases: ${pattern}`);
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  // New, uncommitted infrastructure files must also be present during local checks.
  tracked.push(
    ...execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter((file) => /^(scripts\/ci|tests\/ci)\//.test(file)),
  );
  function copySource(sandbox) {
    for (const file of new Set(
      tracked.filter(
        (file) => !file.startsWith('node_modules') && !file.startsWith('.env'),
      ),
    )) {
      mkdirSync(dirname(resolve(sandbox, file)), { recursive: true });
      cpSync(file, resolve(sandbox, file));
    }
    symlinkSync(
      resolve('node_modules'),
      resolve(sandbox, 'node_modules'),
      'dir',
    );
  }
  // Migrate and create real synthetic credentials once. Each case receives a
  // byte-for-byte fresh SQLite copy; its fresh server still owns real auth quotas.
  const fixtureDirectory = mkdtempSync(`${tmpdir()}/yazio-browser-fixture-`);
  const fixtureStart = performance.now();
  let fixture;
  try {
    copySource(fixtureDirectory);
    const status = await runProcessGroup(
      'pnpm',
      ['exec', 'tsx', 'scripts/prepare-e2e.ts'],
      {
        cwd: fixtureDirectory,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          GRANT_OWNER_ACCESS: 'false',
          DATABASE_URL: 'file:./.data/e2e.sqlite',
          BETTER_AUTH_URL: 'https://localhost:3160',
          BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
          DEMO_MODE: 'false',
          ENABLE_NUTRITION_SCHEDULER: 'false',
          TMPDIR: fixtureDirectory,
        },
        signal,
      },
    );
    if (status !== 0) throw new Error('Synthetic fixture preparation failed');
    fixture = readFileSync(resolve(fixtureDirectory, '.data/e2e.sqlite'));
    for (const suffix of ['-wal', '-shm']) {
      try {
        if (
          readFileSync(resolve(fixtureDirectory, `.data/e2e.sqlite${suffix}`))
            .length
        )
          throw new Error('Synthetic fixture must be closed and checkpointed');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
  const fixtureHash = createHash('sha256').update(fixture).digest('hex');
  const combined = {
    suites: [],
    stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0 },
    isolation: {
      concurrency,
      fixtureSeconds: Number(
        ((performance.now() - fixtureStart) / 1000).toFixed(3),
      ),
      cases: [],
      errors: [],
    },
  };
  const projects = [...new Set(cases.map((entry) => entry.project))];
  if (projects.length > 2)
    throw new Error('Isolated browser supports at most two viewport projects');
  const groups =
    projects.length === 2
      ? projects.map((project) =>
          cases.filter((entry) => entry.project === project),
        )
      : Array.from({ length: Math.min(concurrency, cases.length) }, (_, slot) =>
          cases.filter(
            (_, index) => index % Math.min(concurrency, cases.length) === slot,
          ),
        );
  const allowedMobileSkips = {
    'e2e/workouts.spec.ts': [
      'a save settling after Back does not redirect or repeat the write',
      'actual draft survives conflict and access errors; unavailable storage requires explicit leave',
      'late actual save cannot erase a reopened draft or redirect it',
      'retained planned and actual editors hide cached drafts before real access revalidation and denial',
    ],
    'e2e/transformmate-ui.spec.ts': [
      'real authenticated session throttle is retried once after its server interval',
    ],
  };
  async function worker(selectedCases, slot) {
    if (signal.aborted) return;
    const sandbox = mkdtempSync(`${tmpdir()}/yazio-browser-worker-`);
    const start = performance.now();
    try {
      copySource(sandbox);
      cpSync('.next/standalone', resolve(sandbox, '.next/standalone'), {
        recursive: true,
        filter: (source) =>
          resolve(source) !== resolve('.next/standalone/node_modules'),
      });
      symlinkSync(
        resolve('.next/standalone/node_modules'),
        resolve(sandbox, '.next/standalone/node_modules'),
        'dir',
      );
      mkdirSync(resolve(sandbox, '.tmp'), { recursive: true });
      cpSync('.next/BUILD_ID', resolve(sandbox, '.next/BUILD_ID'));
      cpSync('public', resolve(sandbox, 'public'), { recursive: true });
      mkdirSync(resolve(sandbox, '.data'), { recursive: true });
      writeFileSync(resolve(sandbox, '.data/e2e.sqlite'), fixture);
      const gatewayPort = 3260 + slot * 2;
      const copiedSeconds = (performance.now() - start) / 1000;
      const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
      const status = await runProcessGroup(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '--config',
          run.config,
          ...new Set(selectedCases.map((entry) => entry.file)),
          '--project',
          selectedCases[0].project,
          '--workers=1',
          '--grep',
          `(?:${[...new Set(selectedCases.map((entry) => escape(entry.title)))].join('|')})$`,
        ],
        {
          cwd: sandbox,
          env: {
            ...process.env,
            CI_E2E_ORIGIN: `https://localhost:${gatewayPort}`,
            CI_E2E_BACKEND_PORT: String(gatewayPort + 1),
            CI_E2E_FIXTURE_SHA256: fixtureHash,
            CI_E2E_WORKER: 'true',
            TMPDIR: resolve(sandbox, '.tmp'),
          },
          signal,
        },
      );
      const report = JSON.parse(
        readFileSync(
          resolve(sandbox, `test-results/${run.family}.json`),
          'utf8',
        ),
      );
      const starts = readFileSync(
        resolve(sandbox, 'test-results/production-starts.jsonl'),
        'utf8',
      );
      appendFileSync('test-results/production-starts.jsonl', starts);
      const entries = [];
      const collect = (suites) => {
        for (const suite of suites ?? []) {
          for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? [])
              entries.push({
                file: spec.file,
                line: spec.line,
                title: spec.title,
                project: test.projectName,
                status: test.status,
                seconds: (test.results?.[0]?.duration ?? 0) / 1000,
              });
          }
          collect(suite.suites);
        }
      };
      collect(report.suites);
      const key = (entry) =>
        JSON.stringify([entry.file, entry.line, entry.title, entry.project]);
      if (
        JSON.stringify(entries.map(key).sort()) !==
        JSON.stringify(selectedCases.map(key).sort())
      )
        throw new Error('Worker report differs from enumerated selection');
      combined.suites.push(...report.suites);
      for (const key of ['expected', 'unexpected', 'skipped', 'flaky'])
        combined.stats[key] += report.stats[key] ?? 0;
      combined.isolation.cases.push(...entries);
      combined.isolation.workers ??= [];
      combined.isolation.workers.push({
        slot,
        project: selectedCases[0].project,
        copySeconds: Number(copiedSeconds.toFixed(3)),
        seconds: Number(((performance.now() - start) / 1000).toFixed(3)),
        serverStarts: starts.trim().split('\n').length,
      });
      for (const entry of entries)
        if (
          entry.status === 'skipped' &&
          !(
            entry.project === 'mobile' &&
            allowedMobileSkips[entry.file]?.includes(entry.title)
          )
        )
          throw new Error(`Unexpected skipped isolated case: ${entry.title}`);
      if (
        status !== 0 ||
        report.errors?.length ||
        report.stats.unexpected ||
        report.stats.flaky
      )
        throw new Error('Isolated worker tests failed');
      // Match the reset ledger to actual case keys, rather than counting starts:
      // runtime skips may also initialize fixtures, but cannot hide a missing reset.
      const resetKeys = starts
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.generation > 0)
        .map((entry) => JSON.stringify(entry.caseKey));
      if (
        new Set(resetKeys).size !== resetKeys.length ||
        resetKeys.some(
          (value) => !selectedCases.some((entry) => key(entry) === value),
        ) ||
        entries.some(
          (entry) =>
            entry.status !== 'skipped' && !resetKeys.includes(key(entry)),
        )
      )
        throw new Error('A case did not reset its production server');
      if (report.stats.expected) requirePassingReport(report);
      mkdirSync(`test-results/${run.family}/workers`, { recursive: true });
      writeFileSync(
        `test-results/${run.family}/workers/${slot}.json`,
        JSON.stringify(report, null, 2),
      );
    } catch (error) {
      combined.isolation.errors.push({ slot, message: error.message });
    } finally {
      try {
        try {
          cpSync(
            resolve(sandbox, `test-results/${run.family}/artifacts`),
            `test-results/${run.family}/isolated/worker-${slot}`,
            { recursive: true },
          );
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    }
  }
  // Concurrency1 still enumerates both projects, but runs their separate workers serially.
  const results = [];
  for (let start = 0; start < groups.length; start += concurrency)
    results.push(
      ...(await Promise.allSettled(
        groups
          .slice(start, start + concurrency)
          .map((group, index) => worker(group, start + index)),
      )),
    );
  writeFileSync(
    `test-results/${run.family}.json`,
    JSON.stringify(combined, null, 2),
  );
  for (const result of results)
    if (result.status === 'rejected') throw result.reason;
  if (signal.aborted)
    throw new Error('Browser run cancelled; checkouts removed');
  if (combined.isolation.errors.length)
    throw new Error(JSON.stringify(combined.isolation.errors));
  requirePassingReport(combined, run.requiredCases);
  return combined;
}
