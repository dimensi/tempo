import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { selectAreas } from './selection.mjs';
let paths;
try {
  const before = process.env.CI_BEFORE;
  if (!before || /^0+$/.test(before)) throw new Error('Missing history');
  execFileSync('git', ['merge-base', '--is-ancestor', before, 'HEAD']);
  paths = execFileSync('git', ['diff', '--name-only', before, 'HEAD'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
} catch {
  /* Missing/shallow/rewritten history conservatively selects every area. */
}
const selection = selectAreas(paths, process.env.CI_MODE ?? 'selected');
mkdirSync('test-results', { recursive: true });
writeFileSync(
  'test-results/ci-selection.json',
  JSON.stringify(selection, null, 2),
);
console.log(JSON.stringify(selection));
