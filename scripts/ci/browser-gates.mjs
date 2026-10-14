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
const selection = JSON.parse(
  readFileSync('test-results/ci-selection.json', 'utf8'),
);
const general = {
  nutrition: ['diary.*spec.ts', 'overview.*spec.ts'],
  workouts: ['workouts.spec.ts', 'transformmate.*spec.ts'],
  measurements: ['measurements.spec.ts'],
  analytics: ['analytics.spec.ts'],
  reports: ['reports.*spec.ts'],
  comments: ['comment-ui.spec.ts', 'collaboration.spec.ts'],
  shell: [
    'foundation.spec.ts',
    'health.spec.ts',
    'mobile-inputs.spec.ts',
    'trainer-navigation.spec.ts',
    'settings-navigation.spec.ts',
    'invite-accept.spec.ts',
  ],
};
const slowAuth =
  'real authenticated session throttle is retried once after its server interval';
const runs = [
  {
    family: 'isolation',
    config: 'tests/ci/isolation.config.ts',
    isolated: true,
  },
  {
    family: 'smoke',
    isolated: true,
    config: 'tests/smoke/production.config.ts',
    requiredCases: [
      'production real login',
      'two tabs hide private DOM',
      'refill holds a shared lock',
    ],
  },
];
if (selection.mode === 'full') {
  runs.push({
    family: 'general',
    config: 'playwright.config.ts',
    isolated: true,
  });
} else {
  const files = [
    ...new Set(selection.areas.flatMap((area) => general[area] ?? [])),
  ];
  if (files.length)
    runs.push({
      family: 'general',
      config: 'playwright.config.ts',
      ...(Object.keys(general).every((area) => selection.areas.includes(area))
        ? {}
        : { files }),
      grepInvert: slowAuth,
      isolated: true,
    });
}
if (selection.mode === 'full' || selection.areas.includes('offline'))
  runs.push({
    family: 'offline',
    config: 'tests/offline/production.config.ts',
    requiredCases: [
      { pattern: 'held initial offline install', project: 'desktop' },
    ],
  });
if (selection.mode === 'full' || selection.areas.includes('providers')) {
  runs.push({
    family: 'nutrition',
    config: 'tests/nutrition-sync/e2e.config.ts',
  });
  runs.push({
    family: 'nutrition-connection',
    vitest: true,
    config: 'tests/ci/yazio.config.ts',
  });
  runs.push({
    family: 'transformmate',
    config: 'tests/transformmate-sync/e2e.config.ts',
    requiredCases: [
      {
        pattern: 'owned preview negative requests coalesce',
        project: 'desktop',
      },
    ],
  });
}
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
