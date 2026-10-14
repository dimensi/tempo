import { spawn, execFileSync } from 'node:child_process';
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

// One case/project per disposable checkout and server. The unchanged test-side
// SQLite paths resolve inside that checkout, as do CLI calls, uploads and tokens.
// Real accounts/auth quotas belong to the dedicated Next process and database.
export async function isolatedBrowser(run, concurrency = 2) {
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
  const combined = {
    suites: [],
    stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0 },
    isolation: { concurrency, cases: [], errors: [] },
  };
  let index = 0;
  async function worker(slot) {
    while (index < cases.length) {
      const selected = cases[index++];
      const sandbox = mkdtempSync(`${tmpdir()}/yazio-browser-case-`);
      const start = performance.now();
      try {
        for (const file of new Set(
          tracked.filter(
            (file) =>
              !file.startsWith('node_modules') && !file.startsWith('.env'),
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
        cpSync('.next/standalone', resolve(sandbox, '.next/standalone'), {
          recursive: true,
        });
        cpSync('.next/BUILD_ID', resolve(sandbox, '.next/BUILD_ID'));
        cpSync('public', resolve(sandbox, 'public'), { recursive: true });
        const gatewayPort = 3260 + slot * 2;
        const status = await new Promise((done, reject) => {
          const child = spawn(
            'pnpm',
            [
              'exec',
              'playwright',
              'test',
              '--config',
              run.config,
              `${selected.file}:${selected.line}`,
              '--project',
              selected.project,
              '--workers=1',
              '--grep',
              selected.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
            ],
            {
              cwd: sandbox,
              env: {
                ...process.env,
                CI_E2E_ORIGIN: `https://localhost:${gatewayPort}`,
                CI_E2E_BACKEND_PORT: String(gatewayPort + 1),
              },
              stdio: 'inherit',
            },
          );
          child.on('error', reject);
          child.on('exit', done);
        });
        const report = JSON.parse(
          readFileSync(
            resolve(sandbox, `test-results/${run.family}.json`),
            'utf8',
          ),
        );
        appendFileSync(
          'test-results/production-starts.jsonl',
          readFileSync(
            resolve(sandbox, 'test-results/production-starts.jsonl'),
          ),
        );
        combined.suites.push(...report.suites);
        for (const key of ['expected', 'unexpected', 'skipped', 'flaky'])
          combined.stats[key] += report.stats[key] ?? 0;
        mkdirSync(`test-results/${run.family}/cases`, { recursive: true });
        writeFileSync(
          `test-results/${run.family}/cases/${selected.id}.json`,
          JSON.stringify(report, null, 2),
        );
        combined.isolation.cases.push({
          ...selected,
          seconds: Number(((performance.now() - start) / 1000).toFixed(2)),
        });
        // Every enumerated case must produce exactly one result, even intentional skips.
        if (
          status !== 0 ||
          report.errors?.length ||
          report.stats.expected + report.stats.skipped !== 1 ||
          report.stats.unexpected ||
          report.stats.flaky
        )
          throw new Error(
            `Isolated case failed or missing: ${selected.file}:${selected.line} (${selected.project})`,
          );
        if (report.stats.skipped && selected.project !== 'mobile')
          throw new Error(
            `Unexpected skipped isolated case: ${selected.title}`,
          );
        if (!report.stats.skipped)
          requirePassingReport(report, [
            {
              pattern: selected.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              project: selected.project,
            },
          ]);
      } catch (error) {
        combined.isolation.errors.push({ ...selected, message: error.message });
      } finally {
        // Failure traces remain available in the parent artifact directory.
        const artifact = resolve(
          sandbox,
          `test-results/${run.family}/artifacts`,
        );
        try {
          cpSync(
            artifact,
            `test-results/${run.family}/isolated/${selected.project}-${selected.line}-${selected.file.replaceAll('/', '_')}`,
            { recursive: true },
          );
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        rmSync(sandbox, { recursive: true, force: true });
      }
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, (_, slot) => worker(slot)),
  );
  writeFileSync(
    `test-results/${run.family}.json`,
    JSON.stringify(combined, null, 2),
  );
  for (const result of results)
    if (result.status === 'rejected') throw result.reason;
  if (combined.isolation.errors.length)
    throw new Error(JSON.stringify(combined.isolation.errors));
  requirePassingReport(combined, run.requiredCases);
  return combined;
}
