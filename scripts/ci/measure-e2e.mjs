import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isolatedBrowser } from './isolated-browser.mjs';

// Local opt-in measurement; this does not select or alter any CI/CD gates.
const concurrency = Number(process.argv[2]);
const label = process.argv[3];
if (![1, 2, 3, 4].includes(concurrency) || !/^[a-zA-Z0-9-]+$/.test(label ?? ''))
  throw new Error(
    'Usage: node scripts/ci/measure-e2e.mjs <1..4> <unique-label>',
  );
const directory = `test-results/benchmarks/${label}`;
mkdirSync('test-results/benchmarks', { recursive: true });
mkdirSync(directory);
writeFileSync('test-results/production-starts.jsonl', '');
const evidence = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  productionTree: execFileSync('git', ['rev-parse', 'HEAD:src'], {
    encoding: 'utf8',
  }).trim(),
  buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  concurrency,
  families: [],
};
const start = performance.now();
for (const run of [
  { family: 'general', config: 'playwright.config.ts' },
  { family: 'offline', config: 'tests/offline/production.config.ts' },
  { family: 'transformmate', config: 'tests/transformmate-sync/e2e.config.ts' },
]) {
  const begin = performance.now();
  let error;
  try {
    await isolatedBrowser(run, concurrency);
  } catch (failure) {
    error = failure.message;
  }
  cpSync(`test-results/${run.family}.json`, `${directory}/${run.family}.json`);
  const report = JSON.parse(
    readFileSync(`${directory}/${run.family}.json`, 'utf8'),
  );
  if (readFileSync('.next/BUILD_ID', 'utf8').trim() !== evidence.buildId)
    throw new Error('Prebuilt browser artifact changed during measurement');
  evidence.families.push({
    family: run.family,
    seconds: Number(((performance.now() - begin) / 1000).toFixed(3)),
    stats: report.stats,
    serverStarts: report.isolation.workers?.reduce(
      (sum, worker) => sum + worker.serverStarts,
      0,
    ),
    reset: report.isolation.reset,
    error,
  });
  evidence.seconds = Number(((performance.now() - start) / 1000).toFixed(3));
  writeFileSync(
    `${directory}/evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  if (error) throw new Error(error);
}
cpSync(
  'test-results/production-starts.jsonl',
  `${directory}/production-starts.jsonl`,
);
console.log(JSON.stringify(evidence, null, 2));
